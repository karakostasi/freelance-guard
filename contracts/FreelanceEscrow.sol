// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);
}

/// @title FreelanceEscrow
/// @notice Holds a client's ETH or ERC-20 tokens in escrow, milestone by milestone. Each milestone is
///         funded, delivered and approved on its own. If the client goes silent after delivery, the
///         freelancer can claim a milestone after the review period.
contract FreelanceEscrow {
    enum Status { Unfunded, Funded, Submitted, Disputed, Paid, Refunded }

    struct Milestone {
        string title;
        uint256 amount;
        uint32 duration; // seconds the freelancer has, counted from the moment the milestone is funded
        uint64 deadline; // set when funded
        uint64 submittedAt;
        Status status;
        string deliverable; // URI / IPFS hash of the work
    }

    /// What the client specifies for each milestone when creating a job.
    struct MilestoneInput {
        string title;
        uint256 amount;
        uint32 duration;
    }

    struct Job {
        address client;
        address freelancer;
        address token; // address(0) means ETH, anything else is an ERC-20
        string description; // URI / IPFS hash of the job spec
    }

    uint256 public constant MAX_MILESTONES = 20;

    address public immutable arbiter;
    uint64 public immutable reviewPeriod;

    uint256 public jobCount;
    mapping(uint256 => Job) public jobs;
    mapping(uint256 => Milestone[]) private _milestones;

    event JobCreated(uint256 indexed id, address indexed client, address indexed freelancer, address token, uint256 total, uint256 milestoneCount);
    event MilestoneFunded(uint256 indexed id, uint256 indexed milestone, uint256 amount, uint64 deadline);
    event WorkSubmitted(uint256 indexed id, uint256 indexed milestone, string deliverable);
    event Approved(uint256 indexed id, uint256 indexed milestone);
    event Disputed(uint256 indexed id, uint256 indexed milestone);
    event Resolved(uint256 indexed id, uint256 indexed milestone, bool paidFreelancer);
    event Refunded(uint256 indexed id, uint256 indexed milestone);

    error NotAllowed();
    error WrongStatus();
    error TooEarly();
    error TooLate();
    error TransferFailed();
    error NoSuchMilestone();

    constructor(address _arbiter, uint64 _reviewPeriod) {
        arbiter = _arbiter;
        reviewPeriod = _reviewPeriod;
    }

    // ---------------------------------------------------------------- views

    function milestoneCount(uint256 id) external view returns (uint256) {
        return _milestones[id].length;
    }

    /// @notice A job and all its milestones in one call.
    function getJob(uint256 id) external view returns (Job memory job, Milestone[] memory milestones) {
        return (jobs[id], _milestones[id]);
    }

    // ---------------------------------------------------------------- create & fund

    /// @notice Create a job with one or more milestones. With `fundNow` every milestone is funded in this
    ///         transaction (send the total as msg.value for ETH, or approve the total for a token).
    ///         Without it, the client funds milestones one at a time with fundMilestone.
    function createJob(address freelancer, address token, string calldata description, MilestoneInput[] calldata items, bool fundNow)
        external
        payable
        returns (uint256 id)
    {
        require(items.length > 0 && items.length <= MAX_MILESTONES, "bad milestones");
        require(freelancer != address(0) && freelancer != msg.sender, "bad freelancer");
        if (token != address(0)) require(token.code.length > 0, "bad token");

        id = ++jobCount;
        jobs[id] = Job({client: msg.sender, freelancer: freelancer, token: token, description: description});

        uint256 total;
        for (uint256 i = 0; i < items.length; i++) {
            require(items[i].amount > 0 && items[i].duration > 0, "bad milestone");
            total += items[i].amount;
            _milestones[id].push(
                Milestone({title: items[i].title, amount: items[i].amount, duration: items[i].duration, deadline: 0, submittedAt: 0, status: Status.Unfunded, deliverable: ""})
            );
        }
        emit JobCreated(id, msg.sender, freelancer, token, total, items.length);

        if (fundNow) {
            for (uint256 i = 0; i < items.length; i++) _markFunded(id, i);
            _collect(token, total);
        } else {
            require(msg.value == 0, "no funds expected");
        }
    }

    /// @notice Client funds one milestone. Send the amount as msg.value for ETH, or approve it for a token.
    function fundMilestone(uint256 id, uint256 m) external payable {
        Job storage job = jobs[id];
        Milestone storage ms = _milestone(id, m);
        if (msg.sender != job.client) revert NotAllowed();
        if (ms.status != Status.Unfunded) revert WrongStatus();
        _markFunded(id, m);
        _collect(job.token, ms.amount);
    }

    function _markFunded(uint256 id, uint256 m) private {
        Milestone storage ms = _milestones[id][m];
        ms.status = Status.Funded;
        ms.deadline = uint64(block.timestamp) + ms.duration;
        emit MilestoneFunded(id, m, ms.amount, ms.deadline);
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
        if (msg.sender != jobs[id].freelancer) revert NotAllowed();
        if (ms.status != Status.Funded) revert WrongStatus();
        if (block.timestamp > ms.deadline) revert TooLate();

        ms.status = Status.Submitted;
        ms.submittedAt = uint64(block.timestamp);
        ms.deliverable = deliverable;
        emit WorkSubmitted(id, m, deliverable);
    }

    /// @notice Client accepts the work and releases payment.
    function approve(uint256 id, uint256 m) external {
        Milestone storage ms = _milestone(id, m);
        if (msg.sender != jobs[id].client) revert NotAllowed();
        if (ms.status != Status.Submitted) revert WrongStatus();
        _pay(id, ms);
        emit Approved(id, m);
    }

    /// @notice Freelancer claims payment if the client didn't respond in time.
    function claimAfterTimeout(uint256 id, uint256 m) external {
        Milestone storage ms = _milestone(id, m);
        if (msg.sender != jobs[id].freelancer) revert NotAllowed();
        if (ms.status != Status.Submitted) revert WrongStatus();
        if (block.timestamp < ms.submittedAt + reviewPeriod) revert TooEarly();
        _pay(id, ms);
        emit Approved(id, m);
    }

    /// @notice Client contests the work within the review period.
    function dispute(uint256 id, uint256 m) external {
        Milestone storage ms = _milestone(id, m);
        if (msg.sender != jobs[id].client) revert NotAllowed();
        if (ms.status != Status.Submitted) revert WrongStatus();
        if (block.timestamp >= ms.submittedAt + reviewPeriod) revert TooLate();
        ms.status = Status.Disputed;
        emit Disputed(id, m);
    }

    function resolve(uint256 id, uint256 m, bool paidFreelancer) external {
        Milestone storage ms = _milestone(id, m);
        if (msg.sender != arbiter) revert NotAllowed();
        if (ms.status != Status.Disputed) revert WrongStatus();
        if (paidFreelancer) {
            _pay(id, ms);
        } else {
            _refund(id, m, ms);
        }
        emit Resolved(id, m, paidFreelancer);
    }

    /// @notice Client reclaims a funded milestone if the freelancer never delivered by its deadline.
    function refundExpired(uint256 id, uint256 m) external {
        Milestone storage ms = _milestone(id, m);
        if (msg.sender != jobs[id].client) revert NotAllowed();
        if (ms.status != Status.Funded) revert WrongStatus();
        if (block.timestamp <= ms.deadline) revert TooEarly();
        _refund(id, m, ms);
    }

    // ---------------------------------------------------------------- internals

    function _milestone(uint256 id, uint256 m) private view returns (Milestone storage) {
        if (m >= _milestones[id].length) revert NoSuchMilestone();
        return _milestones[id][m];
    }

    function _pay(uint256 id, Milestone storage ms) private {
        ms.status = Status.Paid;
        _send(jobs[id].token, jobs[id].freelancer, ms.amount);
    }

    function _refund(uint256 id, uint256 m, Milestone storage ms) private {
        ms.status = Status.Refunded;
        _send(jobs[id].token, jobs[id].client, ms.amount);
        emit Refunded(id, m);
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
