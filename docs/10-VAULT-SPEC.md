# KavachVault: contract specification

Exact reference for Phase 3. Where this file and `03-SYSTEM-ARCHITECTURE.md` disagree, this file wins; record the change in `08-DECISIONS.md`.

Solidity `^0.8.24`, Foundry, no external dependencies except a vendored `ReentrancyGuard` pattern (hand-written, 10 lines). No OpenZeppelin `Ownable`, no proxies.

## 1. Constants

| Name | Value | Source |
|---|---|---|
| `PQC_VERIFY` | `0x0000000000000000000000000000000000000a01` | [DOC] evm-precompiles |
| `PQC_STATUS` | `0x0000000000000000000000000000000000000a02` | [DOC] evm-precompiles |
| `PK_LEN` | 2592 | ML-DSA-87 public key |
| `SIG_LEN` | 4627 | ML-DSA-87 signature |
| `ALGO_MLDSA87` | 1 | `pqcKeyStatus` algorithm id |
| `MSG_LEN` | 416 | 13 words of 32 bytes |
| `DOMAIN` | `0xFF` ‖ `"KAVACH-VAULT-v1"` ‖ zero padding to 32 bytes | §3 |
| `QOR` | `address(0)` | native asset marker |
| fUSD | `0x97143B771D34ddb9130b807b135Ae675A5a963CA` (6 decimals) | [DOC] evm-development |
| fETH | `0x02292293c13880a26242690eb70a0e42B8E91c28` (18) | same |
| fBTC | `0x4604e7E45b2ecdbfbDc157103f5B2b62cb16451A` (8) | same |

## 2. Constructor

```solidity
constructor(
    bytes memory ownerPubkey,        // 2592 bytes: the drill account's registered ML-DSA-87 key
    address ownerAccount,            // drill account 0x address
    bytes32 guardianKeyHash,         // keccak256 of the guardian public key
    address[] memory recipients,     // initial allowlist (funder)
    address[] memory tokens,         // fUSD, fETH, fBTC
    Limits[] memory assetLimits,     // one per asset incl. QOR
    uint64 timelockDelay             // seconds
)
```

Constructor checks (revert on failure):
1. `ownerPubkey.length == PK_LEN`.
2. `pqcKeyStatus(ownerAccount)` → `registered`, `algo == 1`, `possessionProven`, and `keccak256(pubkey) == keccak256(ownerPubkey)`. The vault can only be deployed against a correctly registered drill key.
3. `guardianKeyHash != 0` and `!= keccak256(ownerPubkey)`.
4. Every token non-zero and unique; every recipient non-zero.

Default parameters for the drill deployment:

| Parameter | QOR | fUSD | fETH | fBTC |
|---|---|---|---|---|
| Per-tx cap | 25 QOR | 250 | 0.1 | 0.005 |
| Daily cap (rolling 24 h) | 100 QOR | 1,000 | 0.5 | 0.02 |
| Timelock delay | 6 hours (all queued actions) | | | |
| Allowlist | funder account only | | | |

## 3. Message layout (416 bytes, signed raw)

| Word | Bytes | Field |
|---|---|---|
| 0 | 0–31 | `DOMAIN` |
| 1 | 32–63 | `block.chainid` (9800) |
| 2 | 64–95 | `address(this)`, left-padded |
| 3 | 96–127 | `action` (uint256 enum) |
| 4 | 128–159 | `role` (1 = OWNER, 2 = GUARDIAN) |
| 5 | 160–191 | `keyVersion[role]` |
| 6 | 192–223 | `nonces[role]` |
| 7 | 224–255 | `deadline` (unix seconds) |
| 8–12 | 256–415 | action fields, zero if unused (table below) |

| Action (id) | Word 8 | Word 9 | Word 10 | Word 11 | Word 12 |
|---|---|---|---|---|---|
| WITHDRAW (1) | asset | to | amount | 0 | 0 |
| QUEUE_WITHDRAW (2) | asset | to | amount | 0 | 0 |
| QUEUE_SET_LIMITS (3) | asset | perTx | daily | 0 | 0 |
| QUEUE_SET_RECIPIENT (4) | recipient | allowed (0/1) | 0 | 0 | 0 |
| QUEUE_SET_DELAY (5) | newDelay | 0 | 0 | 0 | 0 |
| (6, 7) | reserved, unused: key rotation is not part of this deployment (D-15) | | | | |
| CANCEL (8) | queueId | 0 | 0 | 0 | 0 |
| FREEZE (9) | 0 | 0 | 0 | 0 | 0 |
| UNFREEZE (10) | 0 | 0 | 0 | 0 | 0 |
| HEARTBEAT (11) | 0 | 0 | 0 | 0 | 0 |

The TypeScript builder in `scripts/lib/messages.ts` must produce byte-identical output; a cross-check test compares both for random inputs (Phase 3.1).

## 4. External functions

```solidity
receive() external payable;                                   // QOR deposit, emits Deposited
function depositToken(address token, uint256 amount) external; // listed tokens only; uses balance delta
function withdraw(address asset, address to, uint256 amount, uint256 deadline, bytes calldata pk, bytes calldata sig) external;
function queueAction(uint256 action, bytes32[5] calldata fields, uint256 deadline, bytes calldata pk, bytes calldata sig) external returns (bytes32 id);
function execute(bytes32 id) external;                        // anyone, after eta
function cancel(bytes32 id, uint8 role, uint256 deadline, bytes calldata pk, bytes calldata sig) external;
function freeze(uint8 role, uint256 deadline, bytes calldata pk, bytes calldata sig) external;
function unfreeze(uint256 deadline, bytes calldata ownerPk, bytes calldata ownerSig, bytes calldata guardianPk, bytes calldata guardianSig) external;
function heartbeat(uint256 deadline, bytes calldata pk, bytes calldata sig) external;
// views: nonces, keyVersion, limits, spentToday, queue, frozen, ownerKeyHash, OWNER_ACCOUNT, guardianKeyHash
fallback() external payable { revert(); }
```

Rules per function:
- `withdraw`: role OWNER; not frozen; `to` allowlisted; asset listed; `amount ≤ perTx`; rolling 24 h spend + amount ≤ daily; effects before the transfer; reentrancy guard.
- `queueAction`: role OWNER; not frozen (except nothing); `eta = now + delay`; id = `keccak256(message)`; stores action and fields.
- `execute`: queued, not cancelled, not executed, `now ≥ eta`, not frozen; a queued withdrawal still checks allowlist and listed asset but not the caps.
- `cancel`: OWNER or GUARDIAN.
- `freeze`: OWNER or GUARDIAN.
- `unfreeze`: both signatures, each over its own role's message; both nonces consumed.
- `heartbeat`: role OWNER; works while frozen too (proof of life must never be blocked).
- Rotation: removed in this deployment (D-15). The text below is kept for the record: `QUEUE_ROTATE_OWNER` would execute only if `pqcKeyStatus(OWNER_ACCOUNT)` already returns the new key with `possessionProven`; it bumps `keyVersion[OWNER]`. `ownerKeyHash` is a storage variable for this reason; `OWNER_ACCOUNT` is immutable.

## 5. Events

`Deposited(asset, from, amount)`, `Withdrawn(asset, to, amount, nonce)`, `Queued(id, action, eta)`, `Executed(id)`, `Cancelled(id, role)`, `Frozen(role)`, `Unfrozen()`, `Heartbeat(nonce, blockNumber)`, `KeyRotated(role, newVersion)`.

## 6. Errors

`BadKey()`, `KeyStatus()`, `BadSignature()`, `Expired()`, `BadRole()`, `Frozen()`, `NotAllowed()`, `NotListed()`, `OverPerTx()`, `OverDaily()`, `NotReady()`, `UnknownAction()`, `AlreadyDone()`, `Reentrancy()`, `TransferFailed()`.

## 7. Authentication routine (normative)

Order matters: cheap checks first, the precompile last, the nonce consumed only after success (the whole call reverts on failure, so consumption is atomic).

1. `role ∈ {OWNER, GUARDIAN}` else `BadRole`.
2. `deadline ≥ block.timestamp` else `Expired`.
3. `pk.length == PK_LEN && sig.length == SIG_LEN` else `BadSignature`.
4. `keccak256(pk) == keyHash[role]` else `BadKey`.
5. OWNER only: `pqcKeyStatus(OWNER_ACCOUNT)` returns registered, algo 1, possessionProven, same key hash, else `KeyStatus`.
6. Build the 416-byte message with the **current** `keyVersion[role]` and `nonces[role]`.
7. `IQorePQC(PQC_VERIFY).pqcVerify(pk, sig, message)` via a typed call (empty return data reverts) must be `true`, else `BadSignature`.
8. `nonces[role] += 1`.

## 8. Rolling daily limit

Per asset, a **25**-bucket ring (one bucket per hour; D-17). `spentInWindow = sum of buckets whose hour is within the last 25 hours`. Withdrawal adds to the current hour's bucket. Proof obligation: the sum of outflows in any 24 h interval ≤ daily cap (invariant I4).

## 9. Test list (names map to `04-THREAT-MODEL.md`)

Unit: deposit/withdraw per asset; limits; allowlist; freeze/unfreeze; queue lifecycle; rotation; heartbeat while frozen.
Adversarial: `test_T_A5_drainWithoutSig`, `test_T_B10_replayNonce`, `test_T_B10_replayAfterRotation`, `test_T_B10_expired`, `test_T_B11_crossFormatSig`, `test_T_B12_junkSig` (zero, short, long, random), `test_T_B13_attackerKey`, `test_T_B14_frontRun`, `test_T_B15_reentrancy`, `test_T_B16_forceSend`, `test_T_B17_fakeToken`, `test_T_B18_queueGrief`, `test_T_B19_precompileMissing`, `test_T_B19_emptyReturn`, `test_guardianCannotWithdraw`.
Invariants (Foundry + Medusa): I1–I7 with actors {owner, guardian, anyone, attacker}.
Symbolic (Halmos): `_auth` rejects every input without a matching pre-verified triple; daily-limit arithmetic; queue state transitions.

## 10. KavachColdVault (added 17 Nov, 03:30 IST)

```solidity
constructor(bytes memory ownerPubkey, address ownerAccount, address[] memory recipients, address[] memory tokens, uint64 releaseTime)
receive() external payable;                                     // deposits
function depositToken(address token, uint256 amount) external;
function release(address asset, address to, uint256 amount, uint256 deadline, bytes calldata pk, bytes calldata sig) external;
fallback() external payable { revert(); }
```

- `releaseTime` = 1795132800 (20 Nov 2026 00:00 UTC), immutable.
- `release` reverts with `Locked()` while `block.timestamp < releaseTime`, **before** any other check.
- After release: same §7 authentication as the hot vault (owner role only), message domain `0xFF ‖ "KAVACH-COLD-v1"`, own nonce, allowlisted recipient.
- No limits, no queue, no guardian, no rotation, no other state-changing function.
