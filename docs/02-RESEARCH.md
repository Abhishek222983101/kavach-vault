# Research: how the chain behaves, the field, and open questions

Researched 17 Nov 2026 from QoreChain's docs repo (`github.com/qorechain/qorechain-docs`, cloned 17 Nov), the public node source (`github.com/qorechain/qorechain-core`, commit `a8d2b7a`, 4 Nov 2026), all 61 project pages on build.qorechain.io/projects, competitor repositories, and Exa web search.

## 1. The two lanes, and where a classical key can act

| Lane | What runs there | Signature the chain demands from an account with a registered post-quantum key | Source |
|---|---|---|---|
| Native (Cosmos) | Bank sends, staking, governance, authz, fee grants, IBC, cross-VM calls, key messages, window messages | Hybrid: secp256k1 **and** ML-DSA-87 on every transaction. A classical-only transaction is refused. | [DOC] key-binding.md §3; [DOC] hardyindex.com/chains/qorechain (independent, read on chain 23 Oct) |
| EVM | MetaMask-style transactions | One secp256k1 signature, admitted **only** while the account has a live EVM authorisation window | [DOC] developer-guide/evm-window-reference.md |

**The window is the only place a stolen classical key can act.** Quote: "A stolen classical key is worth only what an open window admits." Opening, narrowing and closing a window are hybrid-signed, so "the classical key alone can never open one" [DOC evm-window-reference §Why].

Other window facts that matter:
- An account with no window answers `found: false` at `GET /qorechain/pqc/v1/evm_window/{address}` [DOC].
- A transaction that is admitted and then reverts has still used its share of the window [DOC §counting]. A project that keeps a window open can lose its fee budget to junk transactions even when its vault refuses them.
- From v3.2.8 (testnet since 12 Nov), `ecrecover`-based permits and signed orders succeed for an account with a usable post-quantum key **only while its own live window admits the verifying contract** [DOC §permits]. No window, no permits.
- A permit or approval granted inside a window survives after the window closes [DOC §permits]. Our drill account never grants one.
- Window, EIP-7702 consent and abstract-account management must be the account's own top-level hybrid-signed message; they cannot go through authz [DOC §key-changes].

## 2. Key rules

| Rule | Source |
|---|---|
| The post-quantum key is derived from the recovery phrase and bound to the account address: `SHAKE-256("qorechain:pqc:v1|" + address + "|" + mnemonic)` | [DOC] developer-tools/wallet-adapter.md |
| A raw private key cannot give a second key; then the key comes from a separate `QRC1-` recovery code, kept apart from the private key | [DOC] key-binding.md §1 |
| The wallet-signature derivation (`derivePqcKeyFromWallet`) was withdrawn because a page holding the key is unsafe | [DOC] wallet-adapter.md |
| Registration (`MsgRegisterPQCKeyV2`) is the one message the chain accepts with the classical signature only (nothing to check a second signature against yet) | [DOC] key-binding.md §2 |
| An account that already holds a key must hybrid-sign any further key message (code 234) | [DOC] developer-guide/post-quantum-signing.md |
| A key the account used before cannot be registered again (code 232) | [DOC] post-quantum-signing.md |
| Rotation is dual-signed by the old and new key | [DOC] post-quantum-signing.md §key-rotation |
| From v3.2.8 on testnet, the first transaction of a new account must be the registration | [DOC] key-binding.md §2 note |
| A raw second registration "still takes the fee" | [DOC] key-binding.md troubleshooting table |
| `pqcKeyStatus` returns `possessionProven`; a contract that must trust the key has to check it, because proof of possession is optional | [DOC] developer-guide/evm-precompiles.md |

## 3. Where fees are taken: the fee-burn question

The node's transaction-checking chain (ante handler) is public in `app/ante.go`. The post-quantum checks run **before** the fee is deducted [CODE `app/ante.go` lines 319–337]:

```
... ValidateBasic, TxTimeoutHeight, ValidateMemo, ...
NewPQCVerifyDecorator          // line 320
NewPQCHybridVerifyDecorator    // line 322
NewPQCReplayGuardDecorator     // line 324
NewAIAnomalyDecorator          // line 326
...
newFeeRouter (DeductFee)       // line 337
SetPubKey, SigVerification, IncrementSequence
BurnFailedFeeDecorator         // failed-tx fees are burned
```

Consequences:
1. A classical-only transaction that the post-quantum decorators refuse is rejected **before** any fee is charged. It costs the account nothing. [CODE, ordering only]
2. The post-quantum decorators themselves are **closed source**. The public repo ships stubs behind the `!full` build tag (`x/pqc/ante_stub.go`). We cannot read how the registration exemption is implemented. [CODE]
3. If a classical-only `MsgRegisterPQCKeyV2` from an account that already holds a key passes the ante handler (as the exemption for first registration suggests) and is refused later in the message handler (code 234), **the fee is charged and burned**. The docs' "a raw second registration still takes the fee" points this way. [ASSUMED, TEST spike S1]
4. If (3) holds, an attacker can spend any QOR the drill account holds, 0.06 QOR at a time, with nothing but the classical key. Every team that keeps QOR in its drill account loses value. "Most value kept" is the third ranking criterion.

**Our answer:** the drill account holds **zero** QOR and zero tokens. Its fees are paid through a fee grant from a separate funder account, limited to the exact message types we need (spike S2). With an empty balance and a grant that refuses registration messages, a registration spam transaction fails fee deduction in the ante handler and costs nothing.

Also checked: fees can only be paid in `uqor` today; no other denomination is accepted for gas [DOC user-guide/gas-abstraction.md]. Fest tokens in the account could not be burned as fees, but we keep the account empty anyway.

## 4. The field (64 projects on 17 Nov)

Projects by category at the first scan: AI Agents 15, dApp 15, Quantum Pass 15, Encrypted Apps 11, Cross-VM 3, Protocol Builders 2. About a third mention the drill. Drill registrations are not public.

What we saw across the public project pages and repositories (credited, read-only; no code was copied):
- Almost every serious entry is a vault or agent wallet whose authority is an ML-DSA-87 signature checked with `pqcVerify`, not `msg.sender`.
- Many keep an EVM window open on the drill account (scoped to their contracts), or keep a small balance there for fees. That is a legitimate design for a product that needs the account to act on chain, and it gives the attacker a lane to try.
- Several publish an attack script of 13 to 71 attacks, written security proofs, invariant tests, or a guardian with a timelock.

Our choice follows from the ranking rule: an account with no window and no balance gives the attacker no lane and nothing to burn, and the product acts through a vault that ignores the caller.

What the best entry does that we must match or beat (taken from Q-Day Vault's public docs):
- A `0xFF` domain tag so vault messages can never collide with any SDK-signed format.
- Pinning the owner key and checking `pqcKeyStatus` including `possessionProven`.
- A per-role key version counter that cancels anything signed by a replaced key.
- A post-quantum guardian that can cancel and freeze but never move funds; unfreeze needs both keys.
- Written proofs per claim, each linked to tests; a live attack script.

## 5. Ranking analysis and the tie scenario

Ranking: proof of life → fewest successful attacks → most value kept → jury on the threat model.

If 20–50 teams register (likely after the drill post), we expect many of the strong vaults to reach 0 successful attacks against the vault itself. Separation then comes from:
1. **Any loss at all on the account**: fee budget inside an open window, fees burned by registration spam (if S1 confirms), approvals. We lose nothing on these by design.
2. **Value kept**: absolute or relative is unknown (question Q1). We maximise both: everything in the registered contracts, nothing in the account, and as much test value as the faucets allow.
3. **Threat model quality**: see `09-TIE-BREAK-DOSSIER.md`.

## 6. Liveness risks (the bot cannot steal, but could it stop us?)

| Risk | Analysis | Mitigation |
|---|---|---|
| Bot spams classical transactions from our account | Refused in the ante handler before fees; no sequence increment (IncrementSequence runs after the post-quantum checks) [CODE ordering] | None needed; verify in the attack simulation |
| AI anomaly decorator flags our account after spam | Closed source [CODE stub `x/ai/ante_stub.go`]. Unknown whether refused transactions feed it. | Send proof of life in the first minutes, before the bot ramps up; keep a second proof ready |
| Fee grant exhausted by the bot | The grant only pays for hybrid-signed transactions that pass the post-quantum checks first, which the bot cannot produce | Small cap; funder can re-grant at any time |
| Public RPC rate limits per IP | [DOC sdk/reference/network.md] | Script retries across `rpc-testnet.qore.host` and `api-testnet.qore.host`; send early |
| Replay guard rejects post-quantum transactions with stale or future timestamps | [CODE comment line 323] | Machine clock synced (`timedatectl`), checked in the runbook |
| Our laptop is off at 05:30 | Human risk | Script scheduled with a systemd timer; you awake as a backup |

## 7. Open questions

| # | Question | Who can answer | Status |
|---|---|---|---|
| Q1 | Is "most value kept" absolute or a share of the starting value, and does it count the account plus the five contracts? | QoreChain admin (private) | Open |
| Q2 | Does a hybrid-signed native transaction count as the "normal transaction"? | QoreChain admin (private) | Open |
| Q3 | Does an admitted-then-reverted transaction count as a successful attack? | Admin | Open; irrelevant for us if no window is ever open |
| Q4 | Does a fee-granted transaction count as "from that account"? | Admin, or reasoning: the signer and sender is the account | Low risk |
| S1 | Does a classical-only second registration pass the ante handler and burn the fee? | Our spike on a throwaway account | To test |
| S2 | Does a fee grant with an allowed-message list work on testnet v3.2.8? | Our spike | To test |
| S3 | Can `MsgCrossVMCall` call the vault from the native lane without a window? | Our spike ([DOC] marks the direction UNTESTED) | To test |
| S4 | `pqcVerify` exact semantics: raw message bytes, no context string? | Our spike (Q-Day Vault reports raw FIPS-204 over raw bytes) | To test |

## 8. Sources

- QoreChain docs: https://docs.qorechain.io (repo github.com/qorechain/qorechain-docs, local copy in the session scratchpad)
- EVM window reference: https://docs.qorechain.io/developer-guide/evm-window-reference/
- Key binding: https://docs.qorechain.io/build-before-qday/key-binding
- Post-quantum signing: https://docs.qorechain.io/developer-guide/post-quantum-signing
- EVM precompiles: https://docs.qorechain.io/developer-guide/evm-precompiles
- Cross-VM reference: https://docs.qorechain.io/developer-guide/cross-vm-reference
- Node source: https://github.com/qorechain/qorechain-core (`app/ante.go`)
- Example apps: https://github.com/qorechain/build-before-qday
- Independent assessment: https://hardyindex.com/chains/qorechain
- ML-DSA protocol guidance: https://datatracker.ietf.org/doc/html/draft-connolly-cfrg-ml-dsa-security-considerations-02
- Fuzzer comparison: https://guardian.security/blog/echidna-vs-medusa-vs-foundry/
- Trail of Bits skills: https://github.com/trailofbits/skills

## 9. Upgrade research (17 Nov, 03:30 IST)

### 9.1 How big is the real attack surface?
The bot "tries everything that key alone can do". A hand-written list (ours is generated from the registry instead) can always be beaten by a longer list. The complete set is what the chain accepts:
- **74 QoreChain-specific message types** across 16 modules (pqc 12, rdk 9, bridge 8, multilayer 7, amm 7, abstractaccount 7, svm 5, lightnode 5, license 5, stakingtier 4, rlconsensus 4, crossvm 3, gasabstraction 2, inflation 1, burn 1, ai 1) [CODE `proto/qorechain/*`].
- **Every standard module wired in the app**: auth, authz, bank, distribution, gov, group, mint, slashing, staking, feegrant, nft, circuit, evidence, upgrade, consensus, epochs, protocolpool, IBC transfer, EVM (vm, erc20, feemarket, precisebank) [CODE `app/app.go`].
- The testnet's reflection endpoints answer `Not Implemented`, so the list comes from the source, not the API.

**Upgrade:** the attack simulator generates its native attacks from this registry, one classical-only transaction per message type, instead of a hand-picked list. Coverage is then "every message type the chain accepts", which no longer list can exceed.

### 9.2 Fee grant spend limits
A known bug in another Cosmos SDK fork let a grantee exceed the spend limit of an `AllowedMsgAllowance` (sei-cosmos PR #284, 2023). It does not help the bot (the grant is only reached after the post-quantum checks), but spike S2 now also checks that the spend limit holds.

### 9.3 Losing the least if something we did not foresee breaks
Industry custody practice keeps most value in storage that cannot move quickly, even if signing keys are compromised (Trail of Bits, "Safer cold storage on Ethereum", 2025; "firewalled" vault cells with independent limits, 7BlockLabs 2026).

**Upgrade:** split value across independent contracts with different designs:
- **Cold vault** (most value): no outflow at all before a fixed release time after the drill (20 Nov 00:00 UTC); after that, only with an owner ML-DSA-87 signature to the allowlist. About 60 lines, no limits logic, no queue.
- **Hot vault** (a small working balance): the full Kavach Vault, used to show the project works during the drill.
- If an unknown bug hits the hot vault, the most we can lose is its balance, capped further by its daily limit and the watchtower's automatic freeze.

### 9.4 SDK facts checked before the build (`@qorechain/sdk` 0.14.0 type definitions)
- Hybrid transactions: `signAndBroadcastHybrid` / `buildHybridTx` take a cosmjs `StdFee`, which carries an optional `granter`, so the proof of life can name the funder as fee granter without custom code. [CODE SDK d.ts]
- `includePqcPublicKey: true` embeds a PQ public key in the extension "so the chain can auto-register it on first use". The bot could try this with its own key on our account: added as attack B22. [CODE SDK d.ts]
- Fee grants: `msg.feegrant.grant(...)` builds `MsgGrantAllowance`. [CODE SDK d.ts]
- `pqcSign(secretKey, message, { hedged? })`: deterministic by default, empty context. Proofs of possession are signed the same way. [CODE SDK d.ts]
- The strongest competitor's live probe (Q-Day Vault `scripts/probe-pqc.ts`, 14 Nov) reports that the `pqcVerify` precompile checks plain FIPS-204 over the raw message bytes and accepts hedged signatures. We repeat this ourselves in spike S4 rather than trust it.

## 10. Phase 1 spike results (17 Nov 2026, ~04:00–05:00 IST, qorechain-diana) [OBSERVED]

All runs used throwaway accounts (`spike-a`, `spike-b`, `spike-c`). Evidence files are in `evidence/`.

| Spike | Result | Evidence |
|---|---|---|
| **S4** `pqcVerify` semantics | Plain FIPS-204 ML-DSA-87 over the raw message bytes, **empty context only**: a signature made with a non-empty context is rejected. Hedged and deterministic signatures both accepted. Every tampering rejected: message bit flip, message ±1 byte, other key, flipped first/last signature byte, truncated or extended signature, all-zero key or signature, empty key or signature. An **empty message is rejected** even with a valid signature, so never sign an empty message. `pqcKeyStatus` of an unregistered account returns `(false, 0, 0x, false)`. | `spike-s4.json`, `spike-s4b.json` |
| **S5** classical-only attacks on a registered account | Bank send and window open signed classical-only: refused at CheckTx with `pqc` code 20 ("must include the hybrid signature extension"). **Balance change 0, sequence change 0.** Hybrid with a made-up PQ key: code 21, cost 0. | `spike-s1s5.json` |
| **S1** fee burn by registration spam | Classical-only `MsgRegisterPQCKeyV2` from an account that already has a key: refused at **CheckTx** with `pqc` code 234. **No fee taken, sequence unchanged.** The docs' "a raw second registration still takes the fee" applies to a hybrid-signed re-registration, which the bot cannot produce. **The fee-burn attack does not exist for a classical-key attacker.** | `spike-s1s5.json` |
| **S2** scoped fee grant | An account that **never held any QOR** registered its key with proof of possession, fee paid by the grant (balance stayed 0). After a revoke and re-grant limited to `MsgSend` + `MsgCrossVMCall`: classical send, classical registration and classical window open through the grant were all refused (codes 20, 234, 20) with **the grant's spend limit unchanged**. A properly hybrid-signed window open was refused by the grant itself ("message does not exist in allowed messages"). A genuine hybrid send through the grant succeeded and the balance returned to 0. | `spike-s2.json` |
| **S3** native call into the EVM | `MsgCrossVMCall` (hybrid, fee via the grant) from the zero-balance account called `SpikePing.ping()` at `0x2eed8647…7a25`. The contract saw `msg.sender = 0x61E7bc3f…dCD80`, the account's own 0x address. No window was opened (`found:false`), balance stayed 0. The same call signed classical-only was refused with code 20, with or without the grant. | `spike-s3.json`, tx `8834643A…3236` |

What changed in the design because of the spikes:
1. The drill account will **never hold any QOR at all**, not even for its registration: the registration fee is paid through a temporary grant that is then replaced by a grant limited to `MsgSend` + `MsgCrossVMCall` (D-14).
2. The fee-burn concern (S1) is closed. Zero balance stays, because it costs nothing and removes any fee path we have not seen.
3. Proof of life via `MsgCrossVMCall` → vault `heartbeat()` is confirmed to work without a window (D-08 confirmed).

## 11. Tooling notes (17 Nov)
- Slither refuses to overwrite an existing `--json` output file; a stale file looks like unchanged results. Delete it before rerunning.
- `forge build` output can be stale after the mutation script; always `forge build --force` before static analysis.
- Medusa 1.5.1 needs `crytic-compile` and `predeployedContracts` (the `vm.etch` of a contract with PUSH0 code fails in its EVM with "invalid jump destination").

## 12. Live findings (17 Nov)
- The EVM lane refuses a transaction from any account that has no registered PQ key with the message `no usable registered post-quantum key; the EVM lane requires one ... no open EVM authorisation window`. A funded account that has a key but no window is refused too. The bot's own funding accounts are subject to the same rule.
- A transaction from an account with zero balance is refused for balance before the window check is reached.
