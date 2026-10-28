// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);
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
    }

    /// What the payer specifies for each milestone when creating a job.
    struct MilestoneInput {
        string title;
        uint256 amount;
        uint32 duration;
    }

    struct JobOptions {
        address verifier; // may approve submitted milestones for the payer. address(0) for none
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
    }

    /// Per-token settings the owner controls. A token that is not enabled cannot be used for new jobs.
    struct TokenConfig {
        bool enabled;
        uint16 surchargeBps; // payer surcharge for jobs in this token
        uint256 minFee; // smallest fee for a job, in the token's base units
        uint256 minJob; // smallest total for a job, in the token's base units
    }

    uint256 public constant MAX_MILESTONES = 20;
    uint256 public constant BPS = 10_000;
    uint16 public constant MAX_FEE_BPS = 100; // hard limit on what the owner can ever set: 1%
    uint16 public constant MAX_SURCHARGE_BPS = 100;
    uint16 public constant DEFAULT_FEE_BPS = 25;

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
    /// Per token: fees and surcharges earned and not yet sent to the treasury.
    mapping(address => uint256) public accruedFees;

    event JobCreated(
        uint256 indexed id,
        address indexed payer,
        address indexed payee,
        address token,
        uint256 total,
        uint256 milestoneCount,
        uint256 fee,
        uint16 surchargeBps,
        address verifier
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
    event TokenConfigured(address indexed token, bool enabled, uint16 surchargeBps, uint256 minFee, uint256 minJob);
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
    ///         amounts when funding every milestone.
    function quote(address token, uint256[] calldata amounts) external view returns (uint256 total, uint256 fee, uint256 surcharge) {
        TokenConfig memory cfg = tokenConfig[token];
        if (!cfg.enabled) revert TokenNotAllowed();
        for (uint256 i = 0; i < amounts.length; i++) {
            total += amounts[i];
            surcharge += (amounts[i] * cfg.surchargeBps) / BPS;
        }
        fee = _jobFee(cfg.minFee, total);
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

        uint256 total;
        for (uint256 i = 0; i < items.length; i++) {
            require(items[i].amount > 0 && items[i].duration > 0, "bad milestone");
            total += items[i].amount;
        }
        if (total < cfg.minJob) revert JobTooSmall();

        id = ++jobCount;
        uint256 fee = _jobFee(cfg.minFee, total);
        jobs[id] = Job({
            payer: msg.sender,
            payee: payee,
            token: token,
            description: description,
            total: total,
            fee: fee,
            surchargeBps: cfg.surchargeBps,
            verifier: opts.verifier
        });
        for (uint256 i = 0; i < items.length; i++) {
            _milestones[id].push(
                Milestone({title: items[i].title, amount: items[i].amount, duration: items[i].duration, deadline: 0, submittedAt: 0, status: Status.Unfunded, deliverable: ""})
            );
        }
        emit JobCreated(id, msg.sender, payee, token, total, items.length, fee, cfg.surchargeBps, opts.verifier);

        if (opts.fundNow) {
            uint256 due = total;
            for (uint256 i = 0; i < items.length; i++) due += _markFunded(id, i);
            _collect(token, due);
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
        uint256 surcharge = _markFunded(id, m);
        _collect(job.token, ms.amount + surcharge);
    }

    /// Marks a milestone funded and books its surcharge. Returns the surcharge, which the payer pays on top of the amount.
    function _markFunded(uint256 id, uint256 m) private returns (uint256 surcharge) {
        Job storage job = jobs[id];
        Milestone storage ms = _milestones[id][m];
        surcharge = (ms.amount * job.surchargeBps) / BPS;
        ms.status = Status.Funded;
        ms.deadline = uint64(block.timestamp) + ms.duration;
        activeTotal[job.token] += ms.amount;
        accruedFees[job.token] += surcharge;
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

    /// @notice Sends the fees and surcharges earned in `token` to the treasury. Anyone can call it, and the money
    ///         can only go to the treasury. It reverts if what is left would not cover the milestones still in escrow.
    function withdrawFees(address token) external nonReentrant {
        uint256 amount = accruedFees[token];
        if (amount == 0) revert NothingToWithdraw();
        if (_balance(token) < activeTotal[token] + amount) revert Insolvent();
        accruedFees[token] = 0;
        _send(token, treasury, amount);
        emit FeesWithdrawn(token, treasury, amount);
    }

    // ---------------------------------------------------------------- owner

    /// @notice Sets the rules for new jobs in a token. Existing jobs keep the terms they were created with.
    function configureToken(address token, TokenConfig calldata cfg) external onlyOwner {
        // The smallest fee can't be more than 5% of the smallest job, so a wrong value can't eat a payment.
        if (cfg.surchargeBps > MAX_SURCHARGE_BPS || cfg.minFee > cfg.minJob / 20) revert BadConfig();
        if (cfg.enabled && token != address(0) && token.code.length == 0) revert BadConfig();
        tokenConfig[token] = cfg;
        emit TokenConfigured(token, cfg.enabled, cfg.surchargeBps, cfg.minFee, cfg.minJob);
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
        _send(job.token, job.payee, ms.amount - fee);
        emit MilestonePaid(id, m, job.payee, ms.amount, fee);
    }

    /// Returns the whole milestone amount. No fee is taken, and the surcharge paid at funding stays with the platform.
    function _refund(uint256 id, uint256 m, Milestone storage ms) private {
        Job storage job = jobs[id];
        ms.status = Status.Refunded;
        activeTotal[job.token] -= ms.amount;
        _send(job.token, job.payer, ms.amount);
        emit Refunded(id, m);
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
