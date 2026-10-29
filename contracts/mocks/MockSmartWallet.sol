// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// A smart wallet that, like Base Account or a Safe, proves a signature through ERC-1271 instead of with its own key.
/// Used only in tests: it accepts what its owner signed.
contract MockSmartWallet {
    address public immutable owner;

    constructor(address _owner) {
        owner = _owner;
    }

    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        if (signature.length != 65) return 0xffffffff;
        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        uint8 v = uint8(signature[64]);
        address signer = ecrecover(hash, v, r, s);
        return signer != address(0) && signer == owner ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
}
