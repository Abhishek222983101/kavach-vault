// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The 416-byte request that the owner/guardian post-quantum key signs. 13 words of 32 bytes (spec §3).
/// The first byte is 0xFF, which no SDK-signed format starts with, so a signature made for any other
/// QoreChain message can never be a valid vault request.
library KavachMessage {
    uint256 internal constant LENGTH = 416;

    // 0xFF || "KAVACH-VAULT-v1" || zero padding
    bytes32 internal constant HOT_DOMAIN = 0xff4b41564143482d5641554c542d763100000000000000000000000000000000;
    // 0xFF || "KAVACH-COLD-v1" || zero padding
    bytes32 internal constant COLD_DOMAIN = 0xff4b41564143482d434f4c442d76310000000000000000000000000000000000;

    function build(
        bytes32 domain,
        address vault,
        uint256 action,
        uint256 role,
        uint256 keyVersion,
        uint256 nonce,
        uint256 deadline,
        bytes32[5] memory f
    ) internal view returns (bytes memory m) {
        // bytes32[5] is a static array, so it is encoded inline as five consecutive words
        m = abi.encode(domain, block.chainid, vault, action, role, keyVersion, nonce, deadline, f);
        assert(m.length == LENGTH);
    }
}
