// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IQorePQC} from "./interfaces/IQorePQC.sol";
import {KavachMessage} from "./libs/KavachMessage.sol";

/// @title KavachVault (hot vault)
/// @notice Holds QOR and listed ERC-20s. Nothing leaves without an ML-DSA-87 signature from the owner's
/// post-quantum key over the exact request. The caller's address (msg.sender / tx.origin) grants nothing and
/// ecrecover is never used, so a stolen classical key gives an attacker no power here. See docs/10-VAULT-SPEC.md.
contract KavachVault {
    // ---- constants -------------------------------------------------------------------------------------
    IQorePQC internal constant PQC = IQorePQC(0x0000000000000000000000000000000000000a01);
    IQorePQC internal constant PQC_STATUS = IQorePQC(0x0000000000000000000000000000000000000a02);
    uint256 internal constant PK_LEN = 2592;
    uint256 internal constant SIG_LEN = 4627;
    uint8 internal constant ALGO_MLDSA87 = 1;
    address internal constant QOR = address(0);

    uint8 public constant ROLE_OWNER = 1;
    uint8 public constant ROLE_GUARDIAN = 2;

    uint256 internal constant A_WITHDRAW = 1;
    uint256 internal constant A_QUEUE_WITHDRAW = 2;
    uint256 internal constant A_QUEUE_LIMITS = 3;
    uint256 internal constant A_QUEUE_RECIPIENT = 4;
    uint256 internal constant A_QUEUE_DELAY = 5;
    uint256 internal constant A_CANCEL = 8;
    uint256 internal constant A_FREEZE = 9;
    uint256 internal constant A_UNFREEZE = 10;
    uint256 internal constant A_HEARTBEAT = 11;

    /// Keys never rotate in this deployment, so the version bound into every message is constant.
    uint256 internal constant KEY_VERSION = 1;
    uint256 internal constant BUCKETS = 25; // hourly buckets; 25 so any 24 h interval is fully covered
    uint64 internal constant MIN_DELAY = 1 hours;
    uint64 internal constant MAX_DELAY = 7 days;

    // ---- errors ----------------------------------------------------------------------------------------
    error BadRole();
    error Expired();
    error BadSignature();
    error BadKey();
    error KeyStatus();
    error Frozen();
    error NotAllowed();
    error NotListed();
    error OverPerTx();
    error OverDaily();
    error NotReady();
    error UnknownAction();
    error AlreadyDone();
    error Reentrancy();
    error TransferFailed();
    error BadConfig();
    error ZeroAmount();

    // ---- events ----------------------------------------------------------------------------------------
    event Deposited(address indexed asset, address indexed from, uint256 amount);
    event Withdrawn(address indexed asset, address indexed to, uint256 amount, uint256 nonce);
    event Queued(bytes32 indexed id, uint256 action, uint64 eta);
    event Executed(bytes32 indexed id);
    event Cancelled(bytes32 indexed id, uint8 role);
    event Frozen_(uint8 role);
    event Unfrozen();
    event Heartbeat(uint256 nonce, uint256 blockNumber);

    // ---- storage ---------------------------------------------------------------------------------------
    struct Limits {
        uint128 perTx;
        uint128 daily;
    }
    struct Queued_ {
        uint64 eta;
        uint8 action;
        bool done; // executed or cancelled
        bytes32[5] f;
    }

    address public immutable OWNER_ACCOUNT;
    bytes32 public immutable OWNER_KEY_HASH;
    bytes32 public immutable GUARDIAN_KEY_HASH;

    bool public frozen;
    uint64 public timelockDelay;
    mapping(uint8 => uint256) public nonces;
    mapping(address => Limits) public limits;
    mapping(address => bool) public listedAsset;
    mapping(address => bool) public allowedRecipient;
    mapping(bytes32 => Queued_) public queue;

    // rolling 24 h accounting per asset (25 hourly buckets)
    // zero means "empty bucket" by design
    // slither-disable-next-line uninitialized-state
    mapping(address => uint256[25]) private _bucketHour;
    // zero means "empty bucket" by design
    // slither-disable-next-line uninitialized-state
    mapping(address => uint256[25]) private _bucketAmt;

    uint256 private _lock = 1;

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    // ---- constructor -----------------------------------------------------------------------------------
    constructor(
        bytes memory ownerPubkey,
        address ownerAccount,
        bytes32 guardianKeyHash,
        address[] memory recipients,
        address[] memory tokens,
        Limits[] memory assetLimits, // index 0 = QOR, then one per token, same order as `tokens`
        uint64 delay
    ) {
        if (ownerPubkey.length != PK_LEN || ownerAccount == address(0)) revert BadConfig();
        bytes32 h = keccak256(ownerPubkey);
        if (guardianKeyHash == bytes32(0) || guardianKeyHash == h) revert BadConfig();
        if (delay < MIN_DELAY || delay > MAX_DELAY) revert BadConfig();
        if (assetLimits.length != tokens.length + 1) revert BadConfig();
        // The chain must hold exactly this key for the drill account, proven by possession.
        (bool reg, uint8 algo, bytes memory pk, bool pop) = PQC_STATUS.pqcKeyStatus(ownerAccount);
        if (!(reg && algo == ALGO_MLDSA87 && pop && keccak256(pk) == h)) revert KeyStatus();

        OWNER_ACCOUNT = ownerAccount;
        OWNER_KEY_HASH = h;
        GUARDIAN_KEY_HASH = guardianKeyHash;
        timelockDelay = delay;

        listedAsset[QOR] = true;
        _setLimits(QOR, assetLimits[0]);
        for (uint256 i = 0; i < tokens.length; i++) {
            address t = tokens[i];
            if (t == address(0) || listedAsset[t]) revert BadConfig();
            listedAsset[t] = true;
            _setLimits(t, assetLimits[i + 1]);
        }
        for (uint256 i = 0; i < recipients.length; i++) {
            if (recipients[i] == address(0)) revert BadConfig();
            allowedRecipient[recipients[i]] = true;
        }
    }

    // ---- deposits (open to anyone; value only ever enters) -----------------------------------------------
    receive() external payable {
        emit Deposited(QOR, msg.sender, msg.value);
    }

    fallback() external payable {
        revert();
    }

    function depositToken(address token, uint256 amount) external nonReentrant {
        if (token == QOR || !listedAsset[token]) revert NotListed();
        uint256 before = _balanceOf(token);
        _safeTransferFrom(token, msg.sender, address(this), amount);
        uint256 got = _balanceOf(token) - before;
        emit Deposited(token, msg.sender, got);
    }

    // ---- owner actions ---------------------------------------------------------------------------------
    function withdraw(address asset, address to, uint256 amount, uint256 deadline, bytes calldata pk, bytes calldata sig)
        external
        nonReentrant
    {
        if (frozen) revert Frozen();
        if (!listedAsset[asset]) revert NotListed();
        if (!allowedRecipient[to]) revert NotAllowed();
        if (amount == 0) revert ZeroAmount();
        Limits memory l = limits[asset];
        if (amount > l.perTx) revert OverPerTx();
        uint256 nonce = _auth(ROLE_OWNER, A_WITHDRAW, deadline, pk, sig, _f3(bytes32(uint256(uint160(asset))), bytes32(uint256(uint160(to))), bytes32(amount)));
        _spend(asset, amount, l.daily); // effects before the transfer
        _pay(asset, to, amount);
        emit Withdrawn(asset, to, amount, nonce);
    }

    function queueAction(uint256 action, bytes32[5] calldata f, uint256 deadline, bytes calldata pk, bytes calldata sig)
        external
        returns (bytes32 id)
    {
        if (frozen) revert Frozen();
        if (action != A_QUEUE_WITHDRAW && action != A_QUEUE_LIMITS && action != A_QUEUE_RECIPIENT && action != A_QUEUE_DELAY) {
            revert UnknownAction();
        }
        uint256 nonce = _auth(ROLE_OWNER, action, deadline, pk, sig, f);
        id = keccak256(KavachMessage.build(KavachMessage.HOT_DOMAIN, address(this), action, ROLE_OWNER, KEY_VERSION, nonce, deadline, f));
        uint64 eta = uint64(block.timestamp) + timelockDelay;
        queue[id] = Queued_({eta: eta, action: uint8(action), done: false, f: f});
        emit Queued(id, action, eta);
    }

    /// Anyone may trigger a queued action once its delay has passed.
    function execute(bytes32 id) external nonReentrant {
        if (frozen) revert Frozen();
        Queued_ storage q = queue[id];
        if (q.eta == 0) revert UnknownAction();
        if (q.done) revert AlreadyDone();
        if (block.timestamp < q.eta) revert NotReady();
        q.done = true;
        uint8 a = q.action;
        if (a == A_QUEUE_WITHDRAW) {
            address asset = address(uint160(uint256(q.f[0])));
            address to = address(uint160(uint256(q.f[1])));
            uint256 amount = uint256(q.f[2]);
            if (!listedAsset[asset]) revert NotListed();
            if (!allowedRecipient[to]) revert NotAllowed();
            if (amount == 0) revert ZeroAmount();
            _pay(asset, to, amount);
            emit Withdrawn(asset, to, amount, 0);
        } else if (a == A_QUEUE_LIMITS) {
            address asset = address(uint160(uint256(q.f[0])));
            if (!listedAsset[asset]) revert NotListed();
            uint256 perTx = uint256(q.f[1]);
            uint256 daily = uint256(q.f[2]);
            if (perTx > type(uint128).max || daily > type(uint128).max) revert BadConfig();
            _setLimits(asset, Limits(uint128(perTx), uint128(daily)));
        } else if (a == A_QUEUE_RECIPIENT) {
            address r = address(uint160(uint256(q.f[0])));
            if (r == address(0)) revert BadConfig();
            allowedRecipient[r] = uint256(q.f[1]) == 1;
        } else if (a == A_QUEUE_DELAY) {
            uint256 d = uint256(q.f[0]);
            if (d < MIN_DELAY || d > MAX_DELAY) revert BadConfig();
            timelockDelay = uint64(d);
        } else {
            revert UnknownAction();
        }
        emit Executed(id);
    }

    function cancel(bytes32 id, uint8 role, uint256 deadline, bytes calldata pk, bytes calldata sig) external {
        Queued_ storage q = queue[id];
        if (q.eta == 0) revert UnknownAction();
        if (q.done) revert AlreadyDone();
        _auth(role, A_CANCEL, deadline, pk, sig, _f3(id, 0, 0));
        q.done = true;
        emit Cancelled(id, role);
    }

    function freeze(uint8 role, uint256 deadline, bytes calldata pk, bytes calldata sig) external {
        _auth(role, A_FREEZE, deadline, pk, sig, _f3(0, 0, 0));
        frozen = true;
        emit Frozen_(role);
    }

    /// Unfreezing needs the owner and the guardian together.
    function unfreeze(
        uint256 deadline,
        bytes calldata ownerPk,
        bytes calldata ownerSig,
        bytes calldata guardianPk,
        bytes calldata guardianSig
    ) external {
        _auth(ROLE_OWNER, A_UNFREEZE, deadline, ownerPk, ownerSig, _f3(0, 0, 0));
        _auth(ROLE_GUARDIAN, A_UNFREEZE, deadline, guardianPk, guardianSig, _f3(0, 0, 0));
        frozen = false;
        emit Unfrozen();
    }

    /// Proof of life: moves no value and works while frozen.
    function heartbeat(uint256 deadline, bytes calldata pk, bytes calldata sig) external {
        uint256 n = _auth(ROLE_OWNER, A_HEARTBEAT, deadline, pk, sig, _f3(0, 0, 0));
        emit Heartbeat(n, block.number);
    }

    // ---- views -----------------------------------------------------------------------------------------
    function spentInWindow(address asset) public view returns (uint256 total) {
        uint256 h = block.timestamp / 1 hours;
        uint256[25] storage hrs = _bucketHour[asset];
        uint256[25] storage amts = _bucketAmt[asset];
        for (uint256 i = 0; i < BUCKETS; i++) {
            if (hrs[i] != 0 && h - hrs[i] < BUCKETS) total += amts[i];
        }
    }

    function messageFor(uint256 action, uint8 role, uint256 deadline, bytes32[5] calldata f) external view returns (bytes memory) {
        return KavachMessage.build(KavachMessage.HOT_DOMAIN, address(this), action, role, KEY_VERSION, nonces[role], deadline, f);
    }

    // ---- internals -------------------------------------------------------------------------------------
    /// Authentication, in the order of spec §7: cheap checks first, the precompiles last, nonce consumed on success.
    function _auth(
        uint8 role,
        uint256 action,
        uint256 deadline,
        bytes calldata pk,
        bytes calldata sig,
        bytes32[5] memory f
    ) internal returns (uint256 nonce) {
        if (role != ROLE_OWNER && role != ROLE_GUARDIAN) revert BadRole();
        if (deadline < block.timestamp) revert Expired();
        if (pk.length != PK_LEN || sig.length != SIG_LEN) revert BadSignature();
        bytes32 pkHash = keccak256(pk);
        if (pkHash != (role == ROLE_OWNER ? OWNER_KEY_HASH : GUARDIAN_KEY_HASH)) revert BadKey();
        if (role == ROLE_OWNER) {
            (bool reg, uint8 algo, bytes memory onchain, bool pop) = PQC_STATUS.pqcKeyStatus(OWNER_ACCOUNT);
            if (!(reg && algo == ALGO_MLDSA87 && pop && keccak256(onchain) == OWNER_KEY_HASH)) revert KeyStatus();
        }
        nonce = nonces[role];
        bytes memory m = KavachMessage.build(KavachMessage.HOT_DOMAIN, address(this), action, role, KEY_VERSION, nonce, deadline, f);
        if (!PQC.pqcVerify(pk, sig, m)) revert BadSignature();
        nonces[role] = nonce + 1;
    }

    function _f3(bytes32 a, bytes32 b, bytes32 c) private pure returns (bytes32[5] memory f) {
        f[0] = a;
        f[1] = b;
        f[2] = c;
    }

    function _setLimits(address asset, Limits memory l) internal {
        if (l.perTx == 0 || l.daily < l.perTx) revert BadConfig();
        limits[asset] = l;
    }

    function _spend(address asset, uint256 amount, uint256 daily) internal {
        uint256 h = block.timestamp / 1 hours;
        // a ring-buffer index, not randomness
        // slither-disable-next-line weak-prng
        uint256 slot = h % BUCKETS;
        uint256[25] storage hrs = _bucketHour[asset];
        uint256[25] storage amts = _bucketAmt[asset];
        if (hrs[slot] != h) {
            hrs[slot] = h;
            amts[slot] = 0;
        }
        if (spentInWindow(asset) + amount > daily) revert OverDaily();
        amts[slot] += amount;
    }

    function _pay(address asset, address to, uint256 amount) internal {
        if (asset == QOR) {
            // every caller path checks an allowlisted recipient and an owner PQ signature (or a queued, owner-signed action)
            // slither-disable-next-line arbitrary-send-eth
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            _safeTransfer(asset, to, amount);
        }
    }

    function _balanceOf(address token) internal view returns (uint256) {
        (bool ok, bytes memory r) = token.staticcall(abi.encodeWithSignature("balanceOf(address)", address(this)));
        if (!ok || r.length < 32) revert TransferFailed();
        return abi.decode(r, (uint256));
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory r) = token.call(abi.encodeWithSignature("transfer(address,uint256)", to, amount));
        if (!ok || (r.length != 0 && !abi.decode(r, (bool)))) revert TransferFailed();
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool ok, bytes memory r) = token.call(abi.encodeWithSignature("transferFrom(address,address,uint256)", from, to, amount));
        if (!ok || (r.length != 0 && !abi.decode(r, (bool)))) revert TransferFailed();
    }
}
