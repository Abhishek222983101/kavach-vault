// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice QoreChain post-quantum precompiles (docs: developer-guide/evm-precompiles).
interface IQorePQC {
    /// ML-DSA-87 (FIPS 204) verification over the raw message bytes, empty context (spike S4).
    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message) external view returns (bool valid);

    function pqcKeyStatus(address account)
        external
        view
        returns (bool registered, uint8 algorithmId, bytes memory pubkey, bool possessionProven);
}
