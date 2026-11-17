// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IQorePQC} from "./interfaces/IQorePQC.sol";
import {KavachMessage} from "./libs/KavachMessage.sol";

/// @title KavachColdVault
/// @notice Deposit-only until RELEASE_TIME. After that, value leaves only with an ML-DSA-87 signature from the owner's
/// post-quantum key to an allowlisted recipient. No limits, no queue, no guardian, no rotation, no admin: the code
/// that can lose money is as small as possible. See docs/10-VAULT-SPEC.md §10.
contract KavachColdVault {
    IQorePQC internal constant PQC = IQorePQC(0x0000000000000000000000000000000000000a01);
    IQorePQC internal constant PQC_STATUS = IQorePQC(0x0000000000000000000000000000000000000a02);
    uint256 internal constant PK_LEN = 2592;
    uint256 internal constant SIG_LEN = 4627;
    uint8 internal constant ALGO_MLDSA87 = 1;
    uint256 internal constant A_RELEASE = 21;
    uint256 internal constant ROLE_OWNER = 1;
    uint256 internal constant KEY_VERSION = 1;

    error Locked();
    error Expired();
    error BadSignature();
    error BadKey();
    error KeyStatus();
    error NotAllowed();
    error NotListed();
    error ZeroAmount();
    error TransferFailed();
    error Reentrancy();
    error BadConfig();

    event Deposited(address indexed asset, address indexed from, uint256 amount);
    event Released(address indexed asset, address indexed to, uint256 amount, uint256 nonce);

    address public immutable OWNER_ACCOUNT;
    bytes32 public immutable OWNER_KEY_HASH;
    uint64 public immutable RELEASE_TIME;

    uint256 public nonce;
    mapping(address => bool) public listedAsset;
    mapping(address => bool) public allowedRecipient;
    uint256 private _lock = 1;

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(bytes memory ownerPubkey, address ownerAccount, address[] memory recipients, address[] memory tokens, uint64 releaseTime) {
        if (ownerPubkey.length != PK_LEN || ownerAccount == address(0) || releaseTime <= block.timestamp) revert BadConfig();
        bytes32 h = keccak256(ownerPubkey);
        (bool reg, uint8 algo, bytes memory pk, bool pop) = PQC_STATUS.pqcKeyStatus(ownerAccount);
        if (!(reg && algo == ALGO_MLDSA87 && pop && keccak256(pk) == h)) revert KeyStatus();
        OWNER_ACCOUNT = ownerAccount;
        OWNER_KEY_HASH = h;
        RELEASE_TIME = releaseTime;
        listedAsset[address(0)] = true;
        for (uint256 i = 0; i < tokens.length; i++) {
            if (tokens[i] == address(0) || listedAsset[tokens[i]]) revert BadConfig();
            listedAsset[tokens[i]] = true;
        }
        for (uint256 i = 0; i < recipients.length; i++) {
            if (recipients[i] == address(0)) revert BadConfig();
            allowedRecipient[recipients[i]] = true;
        }
    }

    receive() external payable {
        emit Deposited(address(0), msg.sender, msg.value);
    }

    fallback() external payable {
        revert();
    }

    function depositToken(address token, uint256 amount) external nonReentrant {
        if (token == address(0) || !listedAsset[token]) revert NotListed();
        (bool ok, bytes memory r) = token.call(abi.encodeWithSignature("transferFrom(address,address,uint256)", msg.sender, address(this), amount));
        if (!ok || (r.length != 0 && !abi.decode(r, (bool)))) revert TransferFailed();
        emit Deposited(token, msg.sender, amount);
    }

    /// Reverts with Locked() before looking at anything else while block.timestamp < RELEASE_TIME.
    function release(address asset, address to, uint256 amount, uint256 deadline, bytes calldata pk, bytes calldata sig) external nonReentrant {
        if (block.timestamp < RELEASE_TIME) revert Locked();
        if (!listedAsset[asset]) revert NotListed();
        if (!allowedRecipient[to]) revert NotAllowed();
        if (amount == 0) revert ZeroAmount();
        if (deadline < block.timestamp) revert Expired();
        if (pk.length != PK_LEN || sig.length != SIG_LEN) revert BadSignature();
        if (keccak256(pk) != OWNER_KEY_HASH) revert BadKey();
        (bool reg, uint8 algo, bytes memory onchain, bool pop) = PQC_STATUS.pqcKeyStatus(OWNER_ACCOUNT);
        if (!(reg && algo == ALGO_MLDSA87 && pop && keccak256(onchain) == OWNER_KEY_HASH)) revert KeyStatus();
        uint256 n = nonce;
        bytes32[5] memory f;
        f[0] = bytes32(uint256(uint160(asset)));
        f[1] = bytes32(uint256(uint160(to)));
        f[2] = bytes32(amount);
        bytes memory m = KavachMessage.build(KavachMessage.COLD_DOMAIN, address(this), A_RELEASE, ROLE_OWNER, KEY_VERSION, n, deadline, f);
        if (!PQC.pqcVerify(pk, sig, m)) revert BadSignature();
        nonce = n + 1;
        if (asset == address(0)) {
            // `to` is an allowlisted recipient and the request is signed by the owner's post-quantum key
            // slither-disable-next-line arbitrary-send-eth
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            (bool ok, bytes memory r) = asset.call(abi.encodeWithSignature("transfer(address,uint256)", to, amount));
            if (!ok || (r.length != 0 && !abi.decode(r, (bool)))) revert TransferFailed();
        }
        emit Released(asset, to, amount, n);
    }

    function messageFor(address asset, address to, uint256 amount, uint256 deadline) external view returns (bytes memory) {
        bytes32[5] memory f;
        f[0] = bytes32(uint256(uint160(asset)));
        f[1] = bytes32(uint256(uint160(to)));
        f[2] = bytes32(amount);
        return KavachMessage.build(KavachMessage.COLD_DOMAIN, address(this), A_RELEASE, ROLE_OWNER, KEY_VERSION, nonce, deadline, f);
    }
}
