// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// What the deploy checks ask of a Safe (its version, owners and threshold), plus a way to make it act. Used only in tests,
/// where it stands in for a real multisig: `exec` runs a call as the safe with no signatures.
contract MockSafe {
    string public constant VERSION = "1.4.1";
    address[] private _owners;
    uint256 private _threshold;

    constructor(address[] memory owners_, uint256 threshold_) {
        _owners = owners_;
        _threshold = threshold_;
    }

    function getOwners() external view returns (address[] memory) {
        return _owners;
    }

    function getThreshold() external view returns (uint256) {
        return _threshold;
    }

    function exec(address to, bytes calldata data) external returns (bytes memory) {
        (bool ok, bytes memory ret) = to.call(data);
        require(ok, "call failed");
        return ret;
    }
}
