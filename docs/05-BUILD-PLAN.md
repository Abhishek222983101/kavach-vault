# Build plan

Hardest and riskiest first. Every sub-phase ends with its acceptance check **actually run**, a short security pass, and a line in `08-DECISIONS.md` if anything was decided. Status: ⬜ not started · 🟡 in progress · ✅ done · ❌ failed (see note).

## Difficulty ranking

| Phase | What | Difficulty (1–5) | Why it is hard |
|---|---|---|---|
| 1 | Spikes on the live testnet | 5 | Closed-source behaviour; the whole design rests on S1–S4 |
| 3 | Vault contract + tests | 4 | Post-quantum signature plumbing, exact message bytes, invariants |
| 5 | Live attack simulator | 4 | Must build every message type with only a classical key |
| 2 | Accounts, keys, registration, grant | 3 | SDK details, proof of possession, fee grants |
| 4 | Deploy, fund, close windows | 3 | Window lifecycle, nonce ordering |
| 6 | Proof of life, watchtower, timer | 3 | Must work unattended at 05:30 |
| 7 | Evidence, proofs, AI_USAGE, page update | 2 | Writing, but it decides ties |

Order of work: 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7. Phase 3 can start in parallel with Phase 1 once S4 (pqcVerify semantics) is known.

## Phase 0: workspace (30 min) ✅ 17 Nov ~04:00 IST (git repo, MIT licence, .gitignore with .secrets/, Foundry 1.8.3, SDK 0.14.0 pinned, clock NTP-synced)

| Sub-phase | Steps | Acceptance |
|---|---|---|
| 0.1 Repo | `git init`, `.gitignore` (`.secrets/`, `.env`, `node_modules`, `out/`, `cache/`), MIT licence, pnpm workspace | `git status` clean; `.secrets/` ignored (`git check-ignore .secrets/x` succeeds) |
| 0.2 Toolchain | Install Foundry (`foundryup`), confirm Node 22 + pnpm 10; add `@qorechain/sdk`, `@qorechain/pqc`, `@qorechain/evm`, `viem`; pin versions | `forge --version`, `pnpm ls` show pinned versions |
| 0.3 Secrets dir | `.secrets/` mode 700, files 600 | `stat -c %a .secrets` = 700 |
| 0.4 Clock | `timedatectl` shows NTP synced | Synced = yes |

## Phase 1: spikes on the testnet (2–3 h) ✅ 17 Nov ~05:00 IST — all five passed; results in `02-RESEARCH.md` §10

Each spike runs on **throwaway** accounts (`spike-*`), never on the real drill account.

| Spike | Question | Steps | Pass | If it fails |
|---|---|---|---|---|
| S4 | `pqcVerify` semantics | Sign raw bytes with `@qorechain/pqc` ML-DSA-87, `eth_call` the precompile with (pk, sig, msg); flip one byte of each | true for the valid triple, false for each flipped one | Read the SDK sign-bytes helpers; adjust the message encoding |
| S1 | Does a classical-only second registration pass the ante handler and burn the fee? | spike-A: register PQ key, hold 1 QOR. Send `MsgRegisterPQCKeyV2` (attacker key) signed classical-only. Read balance before/after | Refused **and** balance unchanged → fee-burn is not a threat | Fee taken → confirms our zero-balance design is essential (record in 02 §3) |
| S2 | Fee grant with an allowed-message list | Funder grants spike-B (0 balance) `AllowedMsgAllowance{MsgSend, MsgCrossVMCall}`. spike-B sends hybrid `MsgSend` with `fee_granter`; then sends classical-only `MsgRegisterPQCKeyV2` with `fee_granter` | First succeeds with fee from the grant; second refused, grant unchanged | Fallback: drill account holds exactly one fee's worth, topped up seconds before the proof |
| S3 | Native call into the vault | spike-B sends `MsgCrossVMCall` (target = a test contract `ping()`), hybrid, through the grant | Event emitted, `msg.sender` = spike-B's 0x | Fallback proof: hybrid `MsgSend` 1 uqor |
| S5 | Classical-only attacks are free | spike-A (registered, 1 QOR): send classical-only `MsgSend`, `MsgOpenEVMWindow` | Both refused, balance unchanged | Record; the zero-balance design already covers it |

Acceptance for the phase: a table of results in `02-RESEARCH.md` §7 with tx hashes, and the design locked in `08-DECISIONS.md`.

## Phase 2: accounts, keys, registration, grant (1 h) ✅ 17 Nov (drill `qor1hk8vnarknzqjd3aa8hcsumxx6l3e6g7zwd2pzp` / `0xbd8EC9F4…23C2`: key registered with proof of possession via grant, balance 0, grant limited to send + cross-VM; guardian PQ key generated in `.secrets/guardian.json`; evidence `evidence/phase2.json`)

| Sub-phase | Steps | Acceptance |
|---|---|---|
| 2.1 Generate keys | `pnpm keys:new` → drill mnemonic, funder mnemonic, guardian `QRC1` code into `.secrets/` | Three files, mode 600; addresses printed only |
| 2.2 Fund | Done: you sent 1,000 QOR to the funder. The drill account gets **no QOR at all** (D-14) | Funder balance on REST |
| 2.3 Register | Funder ✅ registered (tx `9B2F3579…CB55`). Drill: temporary grant (registration allowed) → register via grant → revoke | `possession_proven: true`; drill balance 0 |
| 2.4 Drill never funded | Nothing to empty (D-14) | Drill balance = 0, and it never held QOR |
| 2.5 Scoped grant | Funder grants drill `AllowedMsgAllowance{MsgSend, MsgCrossVMCall}` (limit 2 QOR, expiry 20 Nov 23:59 UTC) | Allowance query shows exactly those two types |

## Phase 3: vault contract and tests (4–5 h) ✅ 17 Nov (66 tests, 6 invariants × 700 runs × 300 calls, Medusa 4 min × 6 properties, Halmos 4 symbolic checks, Slither 0 High/Medium, Semgrep + forge lint, 27/27 mutants killed, AI red team pending → see 3.10)

| Sub-phase | Steps | Acceptance |
|---|---|---|
| 3.1 Interfaces + message library | `IQorePQC`, `KavachMessages.sol` building the §5.2 bytes; TypeScript twin in `scripts/lib/messages.ts` | Cross-check test: Solidity and TS produce identical bytes for 20 random requests |
| 3.2 Core vault | Storage, `_auth`, deposit, withdraw, limits, allowlist, freeze/unfreeze, heartbeat | Unit tests green |
| 3.3 Queue + timelock + rotation | queue, execute, cancel, key versions | Unit tests green |
| 3.4 Precompile mock | Mock that accepts only (pk, sig, msg) triples pre-verified by the real ML-DSA library | Mock tests: real signature accepted, any altered byte refused |
| 3.5 Adversarial tests | Every Bx in `04-THREAT-MODEL.md` that is contract-level, as a named test | All named tests present and green |
| 3.6 Invariants | Foundry invariant runs for I1–I7 (actors: owner, guardian, anyone, attacker) | 256 runs × 200 depth, no failure |
| 3.7 Second fuzzer | Medusa on the same properties | 30 min campaign, no failure |
| 3.8 Symbolic checks | Halmos on `_auth`, limit maths and queue state | All properties proved within bounds |
| 3.9 Static analysis | Slither + Aderyn | No high/medium findings left unexplained |
| 3.10 AI red team | Separate agent reads only the contract and the threat model, tries to break it, reports findings | Every finding fixed or answered in `SECURITY-PROOFS.md` |

## Phase 3b: cold vault (1 h) ✅ 17 Nov (9 tests + fuzz; Halmos `check_coldLockedBeforeRelease`; mutants killed)

| Sub-phase | Steps | Acceptance |
|---|---|---|
| 3b.1 Contract | `KavachColdVault`: deposits; `release(asset, to, amount, deadline, pk, sig)` only after `RELEASE_TIME` and only with owner signature (same message library, own domain name `KAVACH-COLD-v1`) | Unit tests green |
| 3b.2 Proof | Invariant: before `RELEASE_TIME`, no call sequence lowers any balance (fuzz + Halmos) | Proved |

## Phase 4: deploy, fund, close (1 h) ✅ 17 Nov (hot `0x10256edd0877436ffcba8a62b0598f4bad01514b`, cold `0x3fc71af5badd701ff7d718df932e0ddf8612149f`; evidence `evidence/phase4.json`, `evidence/phase4b-cold-canary.json`)

| Sub-phase | Steps | Acceptance |
|---|---|---|
| 4.1 Deploy | Funder opens an unscoped window, deploys with owner key hash, drill address, guardian hash, limits, allowlist | Contract on explorer; constructor args match |
| 4.2 Live auth check | Signed heartbeat via relayer | `Heartbeat` event; nonce 1 |
| 4.3 Fund | Funder sends QOR; fest tokens deposited | Vault balances on explorer |
| 4.4 Live withdrawal test | Small owner-signed withdrawal to the funder | Succeeds; daily counter updates |
| 4.5 Close windows | Funder closes its window | `evm_window/<funder>` and `evm_window/<drill>` both `found: false` |

## Phase 5: live attack simulator (2–3 h) ✅ 17 Nov (verdict **ALL BLOCKED**; `evidence/attack-log.json`)

| Sub-phase | Steps | Acceptance |
|---|---|---|
| 5.1 Native attacks | Generate one classical-only tx **per message type in the chain's registry** (C1), then the fee-granted variant (C2), with only the drill classical key | All refused; drill balance still 0; grant unchanged |
| 5.2 EVM attacks | Raw EVM txs from the drill key: transfer, approve, permit, vault calls | All refused (code 26 or revert) |
| 5.3 Vault attacks from a third account | Junk/forged/replayed/cross-format signatures, attacker key, reentrancy | All revert; vault balance unchanged |
| 5.4 Report | `evidence/attack-log.json` with tx hash, error code and balance deltas per attack | Exit code 0; every row BLOCKED |

## Phase 6: proof of life, watchtower, timer (1.5 h) ✅ 17 Nov (`scripts/heartbeat.mjs`, `scripts/watchtower.mjs`, systemd timers; evidence `rehearsal-heartbeat.json`, `watchtower-test.json`)

| Sub-phase | Steps | Acceptance |
|---|---|---|
| 6.1 Heartbeat script | Native heartbeat through the grant (S3 path or fallback) | Dry run on testnet lands, hash saved |
| 6.2 Watchtower | Polls window, key record, balances, events every 15 s; pre-signed guardian freeze ready | Simulated anomaly triggers alert + freeze on a test vault |
| 6.3 Timer | systemd user timer at 05:31 IST 18 Nov runs heartbeat, then retries every 5 min until confirmed | `systemctl --user list-timers` shows it; test run passes |

## Phase 7: evidence, proofs, AI_USAGE, page (2 h, then again after the drill) 🟡 7.1 to 7.4 done 17 Nov; 7.5 is the person's step; 7.6 after the drill

| Sub-phase | Steps | Acceptance |
|---|---|---|
| 7.1 `SECURITY-PROOFS.md` | One proof per invariant, each linked to its tests | Every claim has a test link |
| 7.2 Evidence snapshot | `pnpm evidence` before registration | `evidence/pre-drill.json` committed |
| 7.3 README + AI_USAGE.md | From `07-AI-WORKFLOW.md` and the decision log | Reviewed by you |
| 7.4 Project page | Update description, testnet addresses, repo link (after cut-off for the strategy details) | Page shows addresses and repo |
| 7.5 Registration ✅ 17 Nov | You paste the drill classical key + vault address | Project page shows registered (`evidence/registration.json`) |
| 7.6 Post-drill | Heartbeat hash submitted; attack log compared with the organisers' log; results published | Page updated by 19 Nov |

## Phase 3 evidence (17 Nov)

| Sub-phase | Result | Evidence |
|---|---|---|
| 3.1 message library | Solidity ↔ TypeScript byte-identical for 12 request shapes (ffi cross-check) | `test/MessageCrossCheck.t.sol`, `scripts/lib/messages.mjs` |
| 3.2 core vault | 26 unit tests green | `test/KavachVault.t.sol` |
| 3.3 queue, timelock | in the same suite; keys do not rotate in this deployment (D-15) | same |
| 3.4 precompile doubles | signature oracle + key-status mock + empty-return mock | `test/mocks/MockPQC.sol` |
| 3.5 adversarial | 24 tests incl. 2 fuzzers of 1,000 runs, 4 reentrancy cases | `test/Adversarial.t.sol` |
| 3.6 invariants | 6 invariants, 700 runs × 300 calls: all pass; a handler accounting bug found and fixed (corrections log #6) | `evidence/foundry-invariants.txt` |
| 3.7 second fuzzer | Medusa 1.5.1, 4 min, 145k calls, 6 properties + 56 assertion tests: pass; canary run proved it reaches successful withdrawals | `evidence/medusa-run.txt`, `test/medusa/Props.sol` |
| 3.8 symbolic | Halmos: 4 checks pass (daily cap with loop bound 30 → 692 paths fully explored) | `test/halmos/Halmos.t.sol` |
| 3.9 static analysis | Slither: 0 High, 0 Medium (3 documented false positives suppressed in-source with reasons); remaining Low = timestamp use (needed for deadlines/timelock). Aderyn could not be installed (crates.io release yanked, npm 404): Semgrep `p/smart-contracts` (34 INFO gas-style notes, 0 security) and `forge lint` used as the second analyser | `evidence/slither.json`, `evidence/semgrep.json` |
| 3.10 AI red team | **pending**: a separate agent that sees only the contract + threat model | – |
| mutation testing | 27 of 27 deliberate breakages detected by the tests (first run found 1 survivor: reentrancy guard on `withdraw`; fixed with guard-independent tests) | `evidence/mutation-report.md` |
| coverage | lines 98.2% (216/220), functions 100%; branch 50% reported by the IR-minimum tool (revert branches are exercised by tests but the tool undercounts them) | `forge coverage --ir-minimum` |

### 3.10 AI red team (17 Nov, blind agent: contract sources only, no tests/docs/reasoning)
Result: no exploit for an attacker holding only the owner's classical key. Three conditional findings, triaged:
| # | Finding | Triage |
|---|---|---|
| F1 | If the classical key could rotate/unregister the PQ key, the live key-status check would lock the owner out (grief, not theft) | Not reachable on this chain: spike S1 shows classical re-registration is refused (code 234) and rotation needs a hybrid signature (`evidence/spike-s1s5.json`). Kept the check: it is a second layer that fails closed. Residual risk recorded. |
| F2 | Queued withdrawals are not counted against the daily cap | By design (D-19): needs owner PQ signature, minimum delay, and the guardian can cancel; the attacker has no PQ key. Documented. |
| F3 | Guardian key hash is not validated on-chain; lost guardian key makes a freeze permanent | Guardian key was generated by us and is stored in `.secrets/guardian.json`; owner alone can freeze, unfreeze needs both, and the cold vault is unaffected. Accepted; backup guardian key copy is a Phase 4 to-do. |
Ideas the agent tried and ruled out (cold lock bypass, cross-vault/role/action replay, nonce handling, daily-cap arithmetic, reentrancy, front-running) match our own tests.

## Phase 4 and 5 evidence (17 Nov)

| Item | Result |
|---|---|
| 4.1 deploy | Cold `0x3fc71af5badd701ff7d718df932e0ddf8612149f` (locked to 1795132800 = 20 Nov 00:00 UTC), hot `0x10256edd0877436ffcba8a62b0598f4bad01514b`; constructor arguments read back and match; drill and guardian not allowlisted; bytecode on chain equals a fresh build of the committed source (immutables masked) |
| 4.2 live auth | Owner-signed heartbeat relayed by the funder; owner nonce 1 (`0xcbe65c616a876c35a23e39fead5c829edf2ffff9510622c4d033650bacbd6e7a`) |
| 4.3 fund | 740 QOR cold, 130 QOR hot (about 85/15); fest tokens are split 85/15 when the funder holds them (none held yet) |
| 4.4 live withdrawal | 1 QOR hot → funder, daily counter 1 QOR, replay of the same signature reverts; cold release refused while locked |
| 4.4b cold canary | A 4-minute-lock twin vault: refused while locked, attacker's own valid ML-DSA key refused after unlock, owner-signed release paid out 1 QOR, replay refused (`0x8a1cd9680a2c28de7dd254c5a46502d6c0932861ca78fc343aed680173a341e9`). The real release path is therefore proven live before 20 Nov |
| 4.5 windows | Funder window closed (`found:false`), drill never had one, drill balance 0 |
| 5.1 native | 298 classical-only attempts (135 registry types × plain and fee-granted, plus 14 hand-built valid attacks × 2): **0 accepted**; 168 refused at the PQ gate (code 20/234), covering 84 distinct message types; the rest refused earlier by stateless validation of our minimal placeholder bodies (they never reach the account check); all 14 hand-built attacks (bank send, window open, attacker key registration, cross-VM into the vaults, authz, feegrant, delegate, IBC, EIP-7702 style delegation) were refused at the PQ gate in both variants. Drill balance, sequence, PQ key, window, funder balance and fee grant unchanged |
| 5.2 EVM | 34 raw EVM txs (legacy, 2930, 1559, 7702, create, approve/transfer of every fest token, Permit2-shaped, vault calls): 0 accepted. The empty drill is refused for zero balance (17); a funded, PQ-registered stand-in with no window is refused for the missing window (17), which is what a bot that funds the drill account first would meet |
| 5.3 vaults | 78 eth_call attacks from a random address and from the drill address (junk, zero, truncated, oversized, replayed, swapped-recipient, cross-vault, cross-role, expired signatures; attacker's own valid key; guardian key as owner): all reverted for the intended reason; 3 controls prove a fresh owner signature still works and cannot be redirected. Live: 4 reverted txs, 1 QOR force-sent by selfdestruct (accounting unaffected), then owner heartbeat and withdrawal still succeed |
| 5.4 report | `evidence/attack-log.json`, verdict ALL BLOCKED |

## Phase 6 and 7 evidence (17 Nov)

| Item | Result |
|---|---|
| 6.1 heartbeat | Native `MsgCrossVMCall` from the drill account into the hot vault's `heartbeat()` with a fresh owner ML-DSA-87 signature, fee paid by the grant, no window, no balance. Rehearsal landed: `8215DF740163619D6B1BCA294B2A56FDBE0FF35BA7331E97DF060C164AF6AEE9` (owner nonce 16 to 17). The rehearsal found the call needs more than 600,000 gas (ML-DSA verification is expensive); the script now starts at 1.5 million and raises gas automatically on "out of gas". Success is judged by the vault's owner nonce moving, not by an event (events from native-lane calls do not appear in `eth_getLogs`) |
| 6.2 watchtower | Polls every 15 s: chain liveness and block age, hot and cold balances, the spend counter, frozen flag, nonces, the drill account's window, balances and key record, the fee grant, the funder, disk space, proof-of-life status. On a critical hot-vault event it freezes with the guardian key through a native call (no window). Test on a throwaway vault: benign heartbeat ignored; an unexpected withdrawal detected and the vault frozen in 6 s; the next withdrawal refused (`evidence/watchtower-test.json`). The freeze request is also simulated against the real vault at every start |
| 6.3 timers | `kavach-watchtower` (23:50 UTC 17 Nov), `kavach-heartbeat` (00:01 UTC 18 Nov), `kavach-heartbeat-retry` (every 5 min from 00:05 UTC), `kavach-heartbeat-extra` (06:30 and 12:30 UTC), `kavach-go-public` (00:05 UTC); sleep is inhibited while they run; linger is on |
| 7.1 proofs | Every test named in `SECURITY-PROOFS.md` exists (checked by script); live confirmation section added |
| 7.2 snapshot | `node scripts/preflight.mjs --snapshot` writes `evidence/pre-drill.json` (re-run right before registering) |
| 7.3 README and AI_USAGE | Regenerated with Phase 6 results |
| 7.4 project page | Draft text prepared (kept local until the repository is public) |

## Keyless cloud backup (17 Nov, added after Phase 7.4)
| Item | Result |
|---|---|
| Pre-signing | `scripts/presign-cloud.mjs`: 3 heartbeats signed by the drill account for consecutive account sequences and vault nonces, 1 freeze signed by a dedicated `freezer` account carrying a guardian-signed request; both simulate successfully on chain. No keys leave the machine |
| Keeper | `cloud/keeper.mjs`: after the drill starts it broadcasts the pre-signed heartbeat if none has landed; on a critical anomaly it broadcasts the pre-signed freeze; it fails loudly on a critical condition. Tested locally against a throwaway vault (heartbeat landed from a stand-in account, a second run did nothing, a simulated unauthorised withdrawal was frozen) |
| Runners | GitHub Actions (every 5 min on 17 to 19 Nov, effective once the repository is public or GitHub billing is fixed) and Vercel cron (00:30 and 12:30 UTC daily, public endpoint protected by a secret, dry run verified) |
| Staleness | The blobs are valid only while the drill account, the freezer and the vault's owner nonce are unchanged; the keeper and `scripts/preflight.mjs` flag a stale set; `scripts/refresh-cloud.sh` and `scripts/deploy-vercel-keeper.sh` re-create them |
