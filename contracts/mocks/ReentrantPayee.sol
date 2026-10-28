// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FreelanceEscrow} from "../FreelanceEscrow.sol";

/// A payee that tries to call back into the escrow while it is being paid. Used only in tests.
contract ReentrantPayee {
    FreelanceEscrow public immutable escrow;
    bool public attempted;
    bool public reentered; // true if the escrow let the nested call through

    constructor(FreelanceEscrow _escrow) {
        escrow = _escrow;
    }

    function submit(uint256 id, uint256 m) external {
        escrow.submitWork(id, m, "x");
    }

    receive() external payable {
        if (attempted) return;
        attempted = true;
        try escrow.withdrawFees(address(0)) {
            reentered = true;
        } catch {}
    }
}
