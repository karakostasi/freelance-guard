// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);
}

/// The part of ERC-4626 the escrow uses.
interface IERC4626Minimal {
    function asset() external view returns (address);
    function balanceOf(address account) external view returns (uint256);
    function previewRedeem(uint256 shares) external view returns (uint256);
    function deposit(uint256 assets, address receiver) external returns (uint256);
    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256);
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256);
}

/// @title FreelanceEscrow
/// @notice Holds a payer's ETH or ERC-20 tokens in escrow, milestone by milestone. Each milestone is
///         funded, delivered and approved on its own. If the payer goes silent after delivery, the
///         payee can claim a milestone after the review period.
///
///         Pricing: the payee pays a fee out of each released milestone, and the payer pays a surcharge
///         when a milestone is funded. Both are fixed when the job is created, so the owner changing the
///         settings later never changes a job that already exists. See docs/contract-v2-design.md.
///
///         Yield: for a token with a vault, a payer can let the money of a job sit in an ERC-4626 vault while it is in
///         escrow. The payer gets the full amount back or the payee gets it, and the platform keeps what the vault
///         earned. A payer who declines pays the surcharge instead and the job never touches the vault.
///
///         A payer can name a verifier for a job, an address that may approve delivered milestones for the
///         payer (an automated check, say). It can do nothing else, and the payer can replace or remove it.
contract FreelanceEscrow {
    enum Status { Unfunded, Funded, Submitted, Disputed, Paid, Refunded }

    struct Milestone {
        string title;
        uint256 amount;
        uint32 duration; // seconds the payee has, counted from the moment the milestone is funded
        uint64 deadline; // set when funded
        uint64 submittedAt;
        Status status;
        string deliverable; // URI / IPFS hash of the work
        uint16 epoch; // 0: the money is idle. Otherwise the token's vaultEpoch when it went into the vault
    }

    /// What the payer specifies for each milestone when creating a job.
    struct MilestoneInput {
        string title;
        uint256 amount;
        uint32 duration;
    }

    struct JobOptions {
        address verifier; // may approve submitted milestones for the payer. address(0) for none
        bool useYield; // put the money in the token's vault while in escrow, instead of paying the surcharge
        bool fundNow; // fund every milestone in the same transaction
    }

    struct Job {
        address payer;
        address payee;
        address token; // address(0) means ETH, anything else is an ERC-20
        string description; // URI / IPFS hash of the job spec
        uint256 total; // sum of the milestone amounts
        uint256 fee; // what the payee pays for the whole job, shared between the milestones by amount
        uint16 surchargeBps; // what the payer pays on top of each milestone, in basis points
        address verifier; // see JobOptions. Fields go at the end, because the server reads `jobs` by position
        bool yield; // the milestones of this job go in the vault, when the token has one
    }

    /// Per-token settings the owner controls. A token that is not enabled cannot be used for new jobs.
    struct TokenConfig {
        bool enabled;
        uint16 surchargeBps; // payer surcharge for jobs in this token
        uint256 minFee; // smallest fee for a job, in the token's base units
        uint256 minJob; // smallest total for a job, in the token's base units
        address vault; // ERC-4626 vault for the token's yield. address(0): no yield. Only changes through exitVault
    }

    uint256 public constant MAX_MILESTONES = 20;
    uint256 public constant BPS = 10_000;
    uint16 public constant MAX_FEE_BPS = 100; // hard limit on what the owner can ever set: 1%
    uint16 public constant MAX_SURCHARGE_BPS = 100;
    uint16 public constant DEFAULT_FEE_BPS = 25;
    /// Base units of rounding that a vault may cost, and the escrow looks past. Each deposit and withdrawal can lose a
    /// unit or two in the vault, and the losses add up until the vault earns them back. Harvesting leaves this much in
    /// the vault, a deposit may come up this much short, and so may a payment (see _leaveVault). A thousandth of a
    /// dollar for a token with six decimals.
    uint256 public constant VAULT_DUST = 1000;

    address public immutable arbiter;
    uint64 public immutable reviewPeriod;

    address public owner;
    address public pendingOwner;
    address public treasury; // where withdrawFees sends the fees
    uint16 public feeBps; // payee fee as a share of the job, before the per-token minimum
    bool public paused; // blocks new jobs and funding. Payments and refunds always work.
    uint256 private _lock = 1;

    uint256 public jobCount;
    mapping(uint256 => Job) public jobs;
    mapping(uint256 => Milestone[]) private _milestones;
    mapping(address => TokenConfig) public tokenConfig;
    /// Per token: the payer money in milestones that are funded and not yet paid or refunded.
    mapping(address => uint256) public activeTotal;
    /// Per token: fees, surcharges and harvested yield earned and not yet sent to the treasury. Always idle.
    mapping(address => uint256) public accruedFees;
    /// Per token: the part of activeTotal that sits in the current vault.
    mapping(address => uint256) public vaultDue;
    /// Per token: counts the vaults used. A milestone whose epoch is not the current one is no longer in the vault.
    mapping(address => uint16) public vaultEpoch;

    event JobCreated(
        uint256 indexed id,
        address indexed payer,
        address indexed payee,
        address token,
        uint256 total,
        uint256 milestoneCount,
        uint256 fee,
        uint16 surchargeBps,
        address verifier,
        bool yield
    );
    event MilestoneFunded(uint256 indexed id, uint256 indexed milestone, uint256 amount, uint256 surcharge, uint64 deadline);
    event WorkSubmitted(uint256 indexed id, uint256 indexed milestone, string deliverable);
    event VerifierSet(uint256 indexed id, address indexed verifier);
    event Approved(uint256 indexed id, uint256 indexed milestone);
    event Disputed(uint256 indexed id, uint256 indexed milestone);
    event Resolved(uint256 indexed id, uint256 indexed milestone, bool paidPayee);
    event Refunded(uint256 indexed id, uint256 indexed milestone);
    /// `gross` is the milestone amount. The payee received `gross - fee`.
    event MilestonePaid(uint256 indexed id, uint256 indexed milestone, address payee, uint256 gross, uint256 fee);
    event FeesWithdrawn(address indexed token, address indexed to, uint256 amount);
    event TokenConfigured(address indexed token, bool enabled, uint16 surchargeBps, uint256 minFee, uint256 minJob, address vault);
    event YieldHarvested(address indexed token, uint256 amount);
    /// `recovered` is what the vault gave back for all shares, `due` what the escrow owed there.
    event VaultExited(address indexed token, address indexed vault, uint256 recovered, uint256 due);
    event FeeBpsSet(uint16 feeBps);
    event TreasurySet(address treasury);
    event PausedSet(bool paused);
    event OwnershipTransferStarted(address indexed owner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotAllowed();
    error WrongStatus();
    error TooEarly();
    error TooLate();
    error TransferFailed();
    error NoSuchMilestone();
    error TokenNotAllowed();
    error JobTooSmall();
    error IsPaused();
    error BadConfig();
    error BadVerifier();
    error NoYield();
    error NoVault();
    error VaultMisbehaved();
    error VaultShort();
    error NothingToWithdraw();
    error Insolvent();
    error Reentrancy();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotAllowed();
        _;
    }

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(address _owner, address _arbiter, address _treasury, uint64 _reviewPeriod) {
        require(_owner != address(0) && _treasury != address(0), "bad address");
        owner = _owner;
        arbiter = _arbiter;
        treasury = _treasury;
        reviewPeriod = _reviewPeriod;
        feeBps = DEFAULT_FEE_BPS;
    }

    // ---------------------------------------------------------------- views

    function milestoneCount(uint256 id) external view returns (uint256) {
        return _milestones[id].length;
    }

    /// @notice A job and all its milestones in one call.
    function getJob(uint256 id) external view returns (Job memory job, Milestone[] memory milestones) {
        return (jobs[id], _milestones[id]);
    }

    /// @notice What a job with these milestone amounts would cost, using the same rules as createJob.
    ///         `fee` is paid by the payee out of the payments, `surcharge` by the payer on top of the
    ///         amounts when funding every milestone. With `useYield` there is no surcharge.
    function quote(address token, uint256[] calldata amounts, bool useYield) external view returns (uint256 total, uint256 fee, uint256 surcharge) {
        TokenConfig memory cfg = tokenConfig[token];
        if (!cfg.enabled) revert TokenNotAllowed();
        if (useYield && cfg.vault == address(0)) revert NoYield();
        for (uint256 i = 0; i < amounts.length; i++) {
            total += amounts[i];
            if (!useYield) surcharge += (amounts[i] * cfg.surchargeBps) / BPS;
        }
        fee = _jobFee(cfg.minFee, total);
    }

    /// @notice How much the vault is short of what the escrow owes in it. Zero unless the vault lost money.
    function shortfall(address token) public view returns (uint256) {
        address vault = tokenConfig[token].vault;
        if (vault == address(0)) return 0;
        uint256 assets = _vaultAssets(vault);
        uint256 due = vaultDue[token];
        return assets < due ? due - assets : 0;
    }

    /// @notice What harvest would move to the fees now.
    function harvestable(address token) public view returns (uint256) {
        address vault = tokenConfig[token].vault;
        if (vault == address(0)) return 0;
        uint256 assets = _vaultAssets(vault);
        uint256 keep = vaultDue[token] + VAULT_DUST;
        return assets > keep ? assets - keep : 0;
    }

    // ---------------------------------------------------------------- create & fund

    /// @notice Create a job with one or more milestones. With `fundNow` every milestone is funded in this
    ///         transaction (send the total plus the surcharge as msg.value for ETH, or approve it for a token).
    ///         Without it, the payer funds milestones one at a time with fundMilestone.
    function createJob(address payee, address token, string calldata description, MilestoneInput[] calldata items, JobOptions calldata opts)
        external
        payable
        nonReentrant
        returns (uint256 id)
    {
        if (paused) revert IsPaused();
        require(items.length > 0 && items.length <= MAX_MILESTONES, "bad milestones");
        require(payee != address(0) && payee != msg.sender, "bad payee");
        if (opts.verifier == payee) revert BadVerifier();
        TokenConfig memory cfg = tokenConfig[token];
        if (!cfg.enabled) revert TokenNotAllowed();
        if (opts.useYield && cfg.vault == address(0)) revert NoYield();

        uint256 total;
        for (uint256 i = 0; i < items.length; i++) {
            require(items[i].amount > 0 && items[i].duration > 0, "bad milestone");
            total += items[i].amount;
        }
        if (total < cfg.minJob) revert JobTooSmall();

        id = ++jobCount;
        uint256 fee = _jobFee(cfg.minFee, total);
        // A job that takes the yield pays no surcharge. The vault earns the platform's share instead.
        jobs[id] = Job({
            payer: msg.sender,
            payee: payee,
            token: token,
            description: description,
            total: total,
            fee: fee,
            surchargeBps: opts.useYield ? 0 : cfg.surchargeBps,
            verifier: opts.verifier,
            yield: opts.useYield
        });
        for (uint256 i = 0; i < items.length; i++) {
            _milestones[id].push(
                Milestone({
                    title: items[i].title,
                    amount: items[i].amount,
                    duration: items[i].duration,
                    deadline: 0,
                    submittedAt: 0,
                    status: Status.Unfunded,
                    deliverable: "",
                    epoch: 0
                })
            );
        }
        emit JobCreated(id, msg.sender, payee, token, total, items.length, fee, jobs[id].surchargeBps, opts.verifier, opts.useYield);

        if (opts.fundNow) {
            uint256 due = total;
            uint256 vaulted;
            for (uint256 i = 0; i < items.length; i++) {
                (uint256 surcharge, uint256 inVault) = _markFunded(id, i);
                due += surcharge;
                vaulted += inVault;
            }
            _collect(token, due);
            if (vaulted > 0) _deposit(token, vaulted);
        } else {
            require(msg.value == 0, "no funds expected");
        }
    }

    /// @notice Payer funds one milestone. Send the amount plus the surcharge as msg.value for ETH, or approve it
    ///         for a token. `quote` tells what that adds up to.
    function fundMilestone(uint256 id, uint256 m) external payable nonReentrant {
        if (paused) revert IsPaused();
        Job storage job = jobs[id];
        Milestone storage ms = _milestone(id, m);
        if (msg.sender != job.payer) revert NotAllowed();
        if (ms.status != Status.Unfunded) revert WrongStatus();
        (uint256 surcharge, uint256 inVault) = _markFunded(id, m);
        _collect(job.token, ms.amount + surcharge);
        if (inVault > 0) _deposit(job.token, inVault);
    }

    /// Marks a milestone funded and books it. Returns the surcharge, which the payer pays on top of the amount, and
    /// how much of the amount the caller must put in the vault once the money is collected. A job that took the
    /// yield funds idle if its token has no vault at this moment, because the owner left the vault with exitVault.
    function _markFunded(uint256 id, uint256 m) private returns (uint256 surcharge, uint256 inVault) {
        Job storage job = jobs[id];
        Milestone storage ms = _milestones[id][m];
        address token = job.token;
        surcharge = (ms.amount * job.surchargeBps) / BPS;
        ms.status = Status.Funded;
        ms.deadline = uint64(block.timestamp) + ms.duration;
        activeTotal[token] += ms.amount;
        accruedFees[token] += surcharge;
        if (job.yield && tokenConfig[token].vault != address(0)) {
            inVault = ms.amount;
            ms.epoch = vaultEpoch[token];
            vaultDue[token] += inVault;
        }
        emit MilestoneFunded(id, m, ms.amount, surcharge, ms.deadline);
    }

    /// Takes the money for `amount`: checks msg.value for ETH, pulls an approved token otherwise.
    function _collect(address token, uint256 amount) private {
        if (token == address(0)) {
            require(msg.value == amount, "wrong amount");
            return;
        }
        require(msg.value == 0, "no ETH expected");
        // Measure what actually arrived, so fee-on-transfer tokens can't leave a milestone under-funded.
        uint256 before = IERC20Minimal(token).balanceOf(address(this));
        _callToken(token, abi.encodeWithSelector(0x23b872dd, msg.sender, address(this), amount)); // transferFrom
        require(IERC20Minimal(token).balanceOf(address(this)) - before == amount, "unsupported token");
    }

    // ---------------------------------------------------------------- delivery & payment

    function submitWork(uint256 id, uint256 m, string calldata deliverable) external {
        Milestone storage ms = _milestone(id, m);
        if (msg.sender != jobs[id].payee) revert NotAllowed();
        if (ms.status != Status.Funded) revert WrongStatus();
        if (block.timestamp > ms.deadline) revert TooLate();

        ms.status = Status.Submitted;
        ms.submittedAt = uint64(block.timestamp);
        ms.deliverable = deliverable;
        emit WorkSubmitted(id, m, deliverable);
    }

    /// @notice Payer, or the job's verifier, accepts the work and releases payment. The payment always goes to the
    ///         payee. Once a verifier approves, the payer can no longer dispute that milestone.
    function approve(uint256 id, uint256 m) external nonReentrant {
        Milestone storage ms = _milestone(id, m);
        Job storage job = jobs[id];
        // msg.sender is never address(0), so a job with no verifier lets in only the payer.
        if (msg.sender != job.payer && msg.sender != job.verifier) revert NotAllowed();
        if (ms.status != Status.Submitted) revert WrongStatus();
        _pay(id, m, ms);
        emit Approved(id, m);
    }

    /// @notice Payee claims payment if the payer didn't respond in time.
    function claimAfterTimeout(uint256 id, uint256 m) external nonReentrant {
        Milestone storage ms = _milestone(id, m);
        if (msg.sender != jobs[id].payee) revert NotAllowed();
        if (ms.status != Status.Submitted) revert WrongStatus();
        if (block.timestamp < ms.submittedAt + reviewPeriod) revert TooEarly();
        _pay(id, m, ms);
        emit Approved(id, m);
    }

    /// @notice Payer contests the work within the review period.
    function dispute(uint256 id, uint256 m) external {
        Milestone storage ms = _milestone(id, m);
        if (msg.sender != jobs[id].payer) revert NotAllowed();
        if (ms.status != Status.Submitted) revert WrongStatus();
        if (block.timestamp >= ms.submittedAt + reviewPeriod) revert TooLate();
        ms.status = Status.Disputed;
        emit Disputed(id, m);
    }

    function resolve(uint256 id, uint256 m, bool paidPayee) external nonReentrant {
        Milestone storage ms = _milestone(id, m);
        if (msg.sender != arbiter) revert NotAllowed();
        if (ms.status != Status.Disputed) revert WrongStatus();
        if (paidPayee) {
            _pay(id, m, ms);
        } else {
            _refund(id, m, ms);
        }
        emit Resolved(id, m, paidPayee);
    }

    /// @notice Payer reclaims a funded milestone if the payee never delivered by its deadline.
    function refundExpired(uint256 id, uint256 m) external nonReentrant {
        Milestone storage ms = _milestone(id, m);
        if (msg.sender != jobs[id].payer) revert NotAllowed();
        if (ms.status != Status.Funded) revert WrongStatus();
        if (block.timestamp <= ms.deadline) revert TooEarly();
        _refund(id, m, ms);
    }

    /// @notice Payer sets, replaces or (with address(0)) removes the job's verifier. It takes effect at once, also
    ///         for milestones that are already submitted.
    function setVerifier(uint256 id, address verifier) external {
        Job storage job = jobs[id];
        if (msg.sender != job.payer) revert NotAllowed();
        if (verifier == job.payee) revert BadVerifier();
        job.verifier = verifier;
        emit VerifierSet(id, verifier);
    }

    // ---------------------------------------------------------------- fees

    /// @notice Sends the fees, surcharges and harvested yield earned in `token` to the treasury. Anyone can call it, and
    ///         the money can only go to the treasury. Money that the milestones still in escrow need stays: the idle
    ///         ones, and the shortfall of the vault if it lost money. So after a loss it sends only what is left over,
    ///         and it reverts if nothing is.
    function withdrawFees(address token) external nonReentrant returns (uint256 amount) {
        amount = accruedFees[token];
        if (amount == 0) revert NothingToWithdraw();
        uint256 held = _balance(token);
        uint256 needed = activeTotal[token] - vaultDue[token] + shortfall(token);
        uint256 spare = held > needed ? held - needed : 0;
        if (spare == 0) revert Insolvent();
        if (spare < amount) amount = spare;
        accruedFees[token] -= amount;
        _send(token, treasury, amount);
        emit FeesWithdrawn(token, treasury, amount);
    }

    /// @notice Moves what the vault earned above what the escrow owes in it to the fees. Anyone can call it. It leaves
    ///         VAULT_DUST base units behind, so rounding in the vault doesn't leave the last milestones short.
    function harvest(address token) external nonReentrant returns (uint256 amount) {
        address vault = tokenConfig[token].vault;
        if (vault == address(0)) revert NoVault();
        amount = harvestable(token);
        if (amount == 0) revert NothingToWithdraw();
        _vaultWithdraw(vault, token, amount);
        accruedFees[token] += amount;
        emit YieldHarvested(token, amount);
    }

    // ---------------------------------------------------------------- owner

    /// @notice Sets the rules for new jobs in a token. Existing jobs keep the terms they were created with.
    function configureToken(address token, TokenConfig calldata cfg) external onlyOwner {
        // The smallest fee can't be more than 5% of the smallest job, so a wrong value can't eat a payment.
        if (cfg.surchargeBps > MAX_SURCHARGE_BPS || cfg.minFee > cfg.minJob / 20) revert BadConfig();
        if (cfg.enabled && token != address(0) && token.code.length == 0) revert BadConfig();
        address current = tokenConfig[token].vault;
        if (cfg.vault != current) {
            // Moving to another vault, or dropping it, goes through exitVault. A vault can only be set when there is none.
            if (current != address(0)) revert BadConfig();
            if (token == address(0) || cfg.vault.code.length == 0 || IERC4626Minimal(cfg.vault).asset() != token) revert BadConfig();
            if (vaultEpoch[token] == 0) vaultEpoch[token] = 1;
        }
        tokenConfig[token] = cfg;
        emit TokenConfigured(token, cfg.enabled, cfg.surchargeBps, cfg.minFee, cfg.minJob, cfg.vault);
    }

    /// @notice Emergency exit: takes everything out of the token's vault and stops using it. Milestones that were in the
    ///         vault are paid from the contract's own balance from now on. What the vault returns above what the escrow
    ///         owed there goes to the fees. If it returns less, the fees not yet withdrawn absorb the loss. It can only be
    ///         called when the vault can pay out all shares. A vault can be set again afterwards with configureToken.
    function exitVault(address token) external onlyOwner nonReentrant {
        address vault = tokenConfig[token].vault;
        if (vault == address(0)) revert NoVault();
        uint256 shares = IERC4626Minimal(vault).balanceOf(address(this));
        uint256 recovered;
        if (shares > 0) {
            uint256 before = IERC20Minimal(token).balanceOf(address(this));
            IERC4626Minimal(vault).redeem(shares, address(this), address(this));
            recovered = IERC20Minimal(token).balanceOf(address(this)) - before;
        }
        uint256 due = vaultDue[token];
        if (recovered >= due) {
            accruedFees[token] += recovered - due;
        } else {
            uint256 loss = due - recovered;
            uint256 fees = accruedFees[token];
            accruedFees[token] = loss >= fees ? 0 : fees - loss;
        }
        vaultDue[token] = 0;
        vaultEpoch[token]++;
        tokenConfig[token].vault = address(0);
        emit VaultExited(token, vault, recovered, due);
    }

    function setFeeBps(uint16 bps) external onlyOwner {
        if (bps > MAX_FEE_BPS) revert BadConfig();
        feeBps = bps;
        emit FeeBpsSet(bps);
    }

    function setTreasury(address to) external onlyOwner {
        if (to == address(0)) revert BadConfig();
        treasury = to;
        emit TreasurySet(to);
    }

    function setPaused(bool value) external onlyOwner {
        paused = value;
        emit PausedSet(value);
    }

    /// @notice Starts handing ownership over. The new owner must call acceptOwnership.
    function transferOwnership(address newOwner) external onlyOwner {
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotAllowed();
        address previous = owner;
        owner = msg.sender;
        pendingOwner = address(0);
        emit OwnershipTransferred(previous, msg.sender);
    }

    // ---------------------------------------------------------------- internals

    function _milestone(uint256 id, uint256 m) private view returns (Milestone storage) {
        if (m >= _milestones[id].length) revert NoSuchMilestone();
        return _milestones[id][m];
    }

    /// The fee for a whole job: the share of the total, or the token's minimum if that is more. Rounds down.
    function _jobFee(uint256 minFee, uint256 total) private view returns (uint256) {
        uint256 share = (total * feeBps) / BPS;
        return share > minFee ? share : minFee;
    }

    /// Pays the payee the milestone amount minus its share of the job fee. The share rounds down, so the
    /// payee keeps any dust.
    function _pay(uint256 id, uint256 m, Milestone storage ms) private {
        Job storage job = jobs[id];
        uint256 fee = (job.fee * ms.amount) / job.total;
        ms.status = Status.Paid;
        activeTotal[job.token] -= ms.amount;
        accruedFees[job.token] += fee;
        uint256 gap = _leaveVault(job.token, ms);
        _send(job.token, job.payee, ms.amount - fee - gap);
        emit MilestonePaid(id, m, job.payee, ms.amount, fee);
    }

    /// Returns the whole milestone amount. No fee is taken, and the surcharge paid at funding stays with the platform.
    function _refund(uint256 id, uint256 m, Milestone storage ms) private {
        Job storage job = jobs[id];
        ms.status = Status.Refunded;
        activeTotal[job.token] -= ms.amount;
        uint256 gap = _leaveVault(job.token, ms);
        _send(job.token, job.payer, ms.amount - gap);
        emit Refunded(id, m);
    }

    /// Takes a milestone's money out of the vault, if that is where it is. A milestone from an earlier vault
    /// (the epoch differs) was already moved into the contract by exitVault.
    ///
    /// Rounding in the vault can leave it a few base units short of the milestone. Up to VAULT_DUST is made up from the
    /// fees. Anything the fees can't cover is returned as `gap`, which the receiver of the milestone goes without. A
    /// bigger shortfall is a loss in the vault, and the milestone waits (VaultShort).
    function _leaveVault(address token, Milestone storage ms) private returns (uint256 gap) {
        if (ms.epoch == 0 || ms.epoch != vaultEpoch[token]) return 0;
        uint256 amount = ms.amount;
        vaultDue[token] -= amount;
        address vault = tokenConfig[token].vault;
        uint256 have = _vaultAssets(vault);
        if (have < amount) {
            gap = amount - have;
            if (gap > VAULT_DUST) revert VaultShort();
            amount = have;
            uint256 fees = accruedFees[token];
            uint256 covered = gap < fees ? gap : fees;
            accruedFees[token] = fees - covered;
            gap -= covered;
        }
        if (amount > 0) _vaultWithdraw(vault, token, amount);
    }

    /// Puts `amount` of the token, already in the contract, into the token's vault.
    function _deposit(address token, uint256 amount) private {
        address vault = tokenConfig[token].vault;
        uint256 assetsBefore = _vaultAssets(vault);
        uint256 idleBefore = IERC20Minimal(token).balanceOf(address(this));
        _callToken(token, abi.encodeWithSelector(0x095ea7b3, vault, amount)); // approve
        IERC4626Minimal(vault).deposit(amount, address(this));
        // The vault must have taken exactly the amount, which uses up the approval, and be worth that much more, give or
        // take rounding.
        if (IERC20Minimal(token).balanceOf(address(this)) + amount != idleBefore) revert VaultMisbehaved();
        if (_vaultAssets(vault) + VAULT_DUST < assetsBefore + amount) revert VaultMisbehaved();
    }

    /// Takes exactly `amount` of the token out of the vault, into the contract.
    function _vaultWithdraw(address vault, address token, uint256 amount) private {
        uint256 before = IERC20Minimal(token).balanceOf(address(this));
        IERC4626Minimal(vault).withdraw(amount, address(this), address(this));
        if (IERC20Minimal(token).balanceOf(address(this)) < before + amount) revert VaultMisbehaved();
    }

    /// What the escrow's shares in the vault are worth.
    function _vaultAssets(address vault) private view returns (uint256) {
        return IERC4626Minimal(vault).previewRedeem(IERC4626Minimal(vault).balanceOf(address(this)));
    }

    function _balance(address token) private view returns (uint256) {
        return token == address(0) ? address(this).balance : IERC20Minimal(token).balanceOf(address(this));
    }

    function _send(address token, address to, uint256 amount) private {
        if (token == address(0)) {
            (bool ok, ) = to.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            _callToken(token, abi.encodeWithSelector(0xa9059cbb, to, amount)); // transfer
        }
    }

    /// Handles tokens that return nothing (like USDT) as well as the ones that return a bool.
    function _callToken(address token, bytes memory data) private {
        (bool ok, bytes memory ret) = token.call(data);
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }
}
