# Security proofs

Each claim has a short argument and the checks that exercise it. "Mock" means the test double for the chain's precompiles
(a signature oracle); real ML-DSA-87 behaviour was confirmed on the live testnet in spike S4 (`evidence/spike-s4*.json`) and
is exercised again in Phase 4/5 on chain.

Notation: **hot** = `KavachVault`, **cold** = `KavachColdVault`, `PQ` = ML-DSA-87.

## I1. Without a valid owner request, no sequence of calls lowers any balance of the hot vault
- Value leaves the contract in exactly two places: `_pay` (called from `withdraw` and `execute`).
- `withdraw` runs `_auth` first; `_auth` needs a `pqcVerify`-valid signature by the pinned owner key over a message that contains the exact asset, recipient and amount, so no other request is accepted.
- `execute` only pays an entry that was created by `queueAction`, which also runs `_auth` with the owner role.
- **Checks:** `test_T_A5_drainWithoutSig`, `testFuzz_T_B12_randomSigNeverVerifies` (1,000 runs), Foundry invariant `balancesExact` (the vault balance equals initial + deposits − owner-authorised outflow, exactly, after every call of 512 runs × 300 calls), Medusa property `balancesExact`.

## I2. No attacker-controlled address ever receives value
- Recipients must be allowlisted; the allowlist changes only through `queueAction` → timelock → `execute`, each needing an owner PQ signature; the constructor allowlist contains only the funder.
- **Checks:** `test_T_A5`, `test_surface_noInstantRuleChange`, invariants `attackersGotNothing` and `rulesUnchanged` (Foundry and Medusa).

## I3. A signature is accepted at most once, only for this vault, chain, role, key version and deadline
- The signed message is 416 bytes: `0xFF‖"KAVACH-VAULT-v1"`, chain id, vault address, action, role, key version, nonce, deadline, 5 action fields. `nonce` is read from storage and incremented only after a successful verification.
- The leading `0xFF` byte cannot start any message the QoreChain SDK signs: text formats are UTF-8 (0xFF never occurs), the hybrid v2 form starts with `q` (0x71), the v1 form is length-framed with a first byte below 0xFF for any realistic transaction.
- **Checks:** `test_T_B10_*` (replay, cross-vault, cross-chain, expiry), `test_T_B11_crossFormatSig` (SDK-like prefix, wrong amount, wrong action, wrong role, wrong deadline), the Solidity/TypeScript message cross-check (`MessageCrossCheck`, 3 tests), invariant `nonceMonotonic…`.

## I4. In any 24-hour interval, instant withdrawals of an asset total at most the daily cap
- `_spend` keeps 25 hourly buckets; the check sums every bucket whose hour is within the last 25 hours. Any 24-hour interval intersects at most 25 hourly buckets, and all of them are inside the window at the time of the last withdrawal in the interval, so the sum checked there bounds the interval's total.
- **Checks:** `test_withdraw_dailyCap_rolling`, `test_withdraw_anyTwentyFourHourIntervalWithinCap` (boundary case), Foundry invariant `dailyCapRespected` (recomputes the sliding sum from the recorded outflows), Medusa property `dailyCapRespected`, Halmos `check_dailyCapNeverExceeded` (symbolic amounts and time gaps).
- Large amounts bypass the daily cap only through the queue, which needs the 6-hour timelock, an owner signature, and can be cancelled or frozen by the guardian.

## I5. The guardian can never move funds
- The guardian role is accepted only by `cancel`, `freeze` and `unfreeze`. `withdraw` and `queueAction` compare the key hash against the owner's.
- **Checks:** `test_guardianCannotMoveFunds`, `test_unfreeze_needsBothKeys`, Foundry/Medusa invariant `guardianNeverMovesFunds`.

## I6. Fail closed: with the precompiles absent, empty or contradicting the vault, every privileged call reverts
- `pqcVerify` and `pqcKeyStatus` are called through typed interfaces: a call to an address with no code reverts, and a call returning empty data reverts on decoding. The owner path also requires `registered`, algorithm 1, `possessionProven`, and the on-chain key hash equal to the pinned one.
- **Checks:** `test_T_B19_*` (missing, empty return, each status field wrong), `test_T_B13_chainKeyChanged…` (owner locks, guardian can still freeze), cold vault `test_cold_failsClosedWhenPrecompilesMisbehave`.

## I7. Liveness: with honest keys and no freeze, the owner can always get value out
- Instant withdrawals within limits; anything larger through the queue after the delay; nothing the attacker can do changes limits, the allowlist or the delay (I2/I3). The guardian can freeze but unfreezing needs both keys, and heartbeat works while frozen.
- **Checks:** `test_queuedWithdraw_waitsForDelay`, `test_heartbeat…`, `test_I7_liveness_*`.

## Cold vault
- **C1** Before `RELEASE_TIME`, no call changes any balance. `release` reverts with `Locked()` before reading any argument; there is no other function that can send value (`fallback` reverts). Checks: `test_T_cold_lockedBeforeRelease_*`, `testFuzz_cold_neverMovesBeforeRelease`, Halmos `check_coldLockedBeforeRelease`.
- **C2** After release, the same signature rules as the hot vault apply with the domain `0xFF‖"KAVACH-COLD-v1"`, so a hot-vault signature can never release cold funds. Checks: `test_cold_replayAndCrossVaultAndDomain`, `test_cold_afterRelease_stillNoDrainWithoutSignature`.

## What these do not cover
- A flaw in QoreChain's own consensus or its closed-source post-quantum module. Mitigation: two independent layers (chain refusal + contract signature check), an empty drill account, and value split 85/15 with the larger share locked until after the drill.
- The mock's signature oracle models "valid iff produced by the key owner"; the real algorithm is exercised on the testnet (spike S4, Phase 4 live signatures).
