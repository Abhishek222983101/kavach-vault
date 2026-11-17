// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Test double for the chain's pqcVerify precompile (0x...0a01), a signature ORACLE.
/// A signature is valid only if its first 32 bytes equal keccak256(secretOf[keccak256(pk)], pk, message), where the
/// secret is known only to the honest signer in the test. Anyone without the secret can only guess 2^-256.
/// The real ML-DSA-87 behaviour was verified on the live testnet in spike S4 and is exercised again in Phase 4.
contract MockPQCVerify {
    mapping(bytes32 => bytes32) public secretOf;

    function setSecret(bytes calldata pk, bytes32 secret) external {
        secretOf[keccak256(pk)] = secret;
    }

    function sign(bytes32 secret, bytes memory pk, bytes memory message) public pure returns (bytes memory sig) {
        sig = new bytes(4627);
        bytes32 tag = keccak256(abi.encode(secret, pk, message));
        for (uint256 i = 0; i < 32; i++) sig[i] = tag[i];
    }

    function pqcVerify(bytes calldata pk, bytes calldata signature, bytes calldata message) external view returns (bool) {
        if (pk.length != 2592 || signature.length != 4627) return false;
        bytes32 secret = secretOf[keccak256(pk)];
        if (secret == bytes32(0)) return false;
        bytes32 want = keccak256(abi.encode(secret, pk, message));
        for (uint256 i = 0; i < 32; i++) if (signature[i] != want[i]) return false;
        for (uint256 i = 32; i < signature.length; i++) if (signature[i] != 0) return false;
        return true;
    }
}

/// @notice Test double for pqcKeyStatus (0x...0a02).
contract MockPQCStatus {
    struct Rec {
        bool registered;
        uint8 algo;
        bytes pubkey;
        bool pop;
    }
    mapping(address => Rec) internal recs;

    function set(address a, bool registered, uint8 algo, bytes calldata pubkey, bool pop) external {
        recs[a] = Rec(registered, algo, pubkey, pop);
    }

    function pqcKeyStatus(address a) external view returns (bool, uint8, bytes memory, bool) {
        Rec storage r = recs[a];
        return (r.registered, r.algo, r.pubkey, r.pop);
    }
}

/// @notice A precompile address that answers with empty data (what an inactive precompile looks like to a low-level caller).
contract EmptyReturn {
    fallback() external {}
}
