// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title FreelanceEscrow
/// @notice Holds a client's ETH until the freelancer delivers. If the client
///         goes silent after delivery, the freelancer can claim after the review period.
contract FreelanceEscrow {
    enum Status { None, Funded, Submitted, Disputed, Paid, Refunded }

    struct Job {
        address client;
        address freelancer;
        uint256 amount;
        uint64 deliveryDeadline; // freelancer must submit by this time
        uint64 submittedAt;
        Status status;
        string description; // URI / IPFS hash of the job spec
        string deliverable; // URI / IPFS hash of the work
    }

    address public immutable arbiter;
    uint64 public immutable reviewPeriod;

    uint256 public jobCount;
    mapping(uint256 => Job) public jobs;

    event JobCreated(uint256 indexed id, address indexed client, address indexed freelancer, uint256 amount, uint64 deliveryDeadline);
    event WorkSubmitted(uint256 indexed id, string deliverable);
    event Approved(uint256 indexed id);
    event Disputed(uint256 indexed id);
    event Resolved(uint256 indexed id, bool paidFreelancer);
    event Refunded(uint256 indexed id);

    error NotAllowed();
    error WrongStatus();
    error TooEarly();
    error TooLate();
    error TransferFailed();

    constructor(address _arbiter, uint64 _reviewPeriod) {
        arbiter = _arbiter;
        reviewPeriod = _reviewPeriod;
    }

    function createJob(address freelancer, uint64 deliveryDeadline, string calldata description)
        external
        payable
        returns (uint256 id)
    {
        require(msg.value > 0, "no funds");
        require(freelancer != address(0) && freelancer != msg.sender, "bad freelancer");
        require(deliveryDeadline > block.timestamp, "bad deadline");

        id = ++jobCount;
        jobs[id] = Job({
            client: msg.sender,
            freelancer: freelancer,
            amount: msg.value,
            deliveryDeadline: deliveryDeadline,
            submittedAt: 0,
            status: Status.Funded,
            description: description,
            deliverable: ""
        });
        emit JobCreated(id, msg.sender, freelancer, msg.value, deliveryDeadline);
    }

    function submitWork(uint256 id, string calldata deliverable) external {
        Job storage j = jobs[id];
        if (msg.sender != j.freelancer) revert NotAllowed();
        if (j.status != Status.Funded) revert WrongStatus();
        if (block.timestamp > j.deliveryDeadline) revert TooLate();

        j.status = Status.Submitted;
        j.submittedAt = uint64(block.timestamp);
        j.deliverable = deliverable;
        emit WorkSubmitted(id, deliverable);
    }

    /// @notice Client accepts the work and releases payment.
    function approve(uint256 id) external {
        Job storage j = jobs[id];
        if (msg.sender != j.client) revert NotAllowed();
        if (j.status != Status.Submitted) revert WrongStatus();
        _pay(j, j.freelancer);
        emit Approved(id);
    }

    /// @notice Freelancer claims payment if the client didn't respond in time.
    function claimAfterTimeout(uint256 id) external {
        Job storage j = jobs[id];
        if (msg.sender != j.freelancer) revert NotAllowed();
        if (j.status != Status.Submitted) revert WrongStatus();
        if (block.timestamp < j.submittedAt + reviewPeriod) revert TooEarly();
        _pay(j, j.freelancer);
        emit Approved(id);
    }

    /// @notice Client contests the work within the review period.
    function dispute(uint256 id) external {
        Job storage j = jobs[id];
        if (msg.sender != j.client) revert NotAllowed();
        if (j.status != Status.Submitted) revert WrongStatus();
        if (block.timestamp >= j.submittedAt + reviewPeriod) revert TooLate();
        j.status = Status.Disputed;
        emit Disputed(id);
    }

    function resolve(uint256 id, bool paidFreelancer) external {
        Job storage j = jobs[id];
        if (msg.sender != arbiter) revert NotAllowed();
        if (j.status != Status.Disputed) revert WrongStatus();
        if (paidFreelancer) {
            _pay(j, j.freelancer);
        } else {
            _refund(id, j);
        }
        emit Resolved(id, paidFreelancer);
    }

    /// @notice Client reclaims funds if the freelancer never delivered by the deadline.
    function refundExpired(uint256 id) external {
        Job storage j = jobs[id];
        if (msg.sender != j.client) revert NotAllowed();
        if (j.status != Status.Funded) revert WrongStatus();
        if (block.timestamp <= j.deliveryDeadline) revert TooEarly();
        _refund(id, j);
    }

    function _pay(Job storage j, address to) private {
        j.status = Status.Paid;
        _send(to, j.amount);
    }

    function _refund(uint256 id, Job storage j) private {
        j.status = Status.Refunded;
        _send(j.client, j.amount);
        emit Refunded(id);
    }

    function _send(address to, uint256 amount) private {
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
