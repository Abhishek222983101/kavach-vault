# Build log

## 17 Nov 2026, Phase 0 (workspace) ✅
- `git init`, MIT licence, `.gitignore` (`.secrets/`, `.env*`, build outputs). `.secrets/` mode 700, files 600; `git check-ignore` confirms it is ignored.
- Foundry 1.8.3 (already in `~/.foundry/bin`); Node 22.23.2, pnpm 10.28.2.
- Pinned: `@qorechain/sdk` 0.14.0, `@qorechain/evm` 0.14.0, `@qorechain/pqc` 0.2.3, `viem` 2.57.20, `cosmjs-types` 0.11.0; dev `@noble/post-quantum` 0.7.1 (independent ML-DSA implementation for tests).
- Clock: NTP synchronised.

## 17 Nov 2026, Phase 1 (spikes) ✅
Accounts: funder `qor10mlhtuc44s38n90uqls7njcushswz338hzyv05` (1,000 test QOR from the team's dashboard wallet), throwaways `spike-a`, `spike-b`, `spike-c`.

| Step | Command | Result |
|---|---|---|
| Register funder | `node scripts/register.mjs funder` | tx `9B2F3579…CB55`, `possession_proven:true`, fee 0.07 QOR |
| Fund + register spikes | `node scripts/fund.mjs funder spike-a 20` etc., `node scripts/register.mjs spike-a spike-b` | both registered with PoP |
| S4 | `node scripts/spike-s4.mjs`, `node scripts/spike-s4b.mjs` | see `02-RESEARCH.md` §10 |
| S5 + S1 | `node scripts/spike-s1s5.mjs` | all classical attacks refused at CheckTx, cost 0 |
| S2 | `node scripts/spike-s2.mjs` | never-funded account works via grant; bot cannot use the grant |
| S3 | `node scripts/spike-s3-deploy.mjs`, `node scripts/spike-s3.mjs`, `node scripts/spike-s3-attack.mjs` | native cross-VM call works without a window; classical version refused |

Lessons: unified (eth-native) accounts must sign with `EthNativeSigner`, not `directSignerFromPrivateKey` (different address derivation). `ensurePqcRegistered` needs `rest`. Every refusal by the post-quantum checks happens at CheckTx, before fees and before the sequence moves.

## 17 Nov 2026, Phases 2, 3, 3b ✅ (3.10 red team pending)
- Phase 2: `node scripts/phase2.mjs` → drill registered via temporary grant, scoped grant installed, balance 0 (`evidence/phase2.json`).
- Contracts: `src/KavachVault.sol`, `src/KavachColdVault.sol`, `src/libs/KavachMessage.sol`, `src/interfaces/IQorePQC.sol`.
- Tests: `forge test` (66 tests incl. invariants), `FOUNDRY_INVARIANT_RUNS=700 FOUNDRY_INVARIANT_DEPTH=300 forge test --match-contract InvariantsTest`, `medusa fuzz --config medusa.json`, `halmos --contract HalmosTest --loop 30 --solver-timeout-assertion 0`, `slither . --filter-paths "lib|test|node_modules" --exclude-informational --json evidence/slither.json`, `python3 scripts/mutate.py`.
- Bugs found by our own tooling: handler accounting (corrections #6), surviving reentrancy mutant (fixed with new tests), `block.timestamp` caching in tests (corrections #7).

## 17 Nov 2026, Phases 4 and 5 ✅
- `node scripts/phase4.mjs` (deploy, heartbeat, fund, withdraw, close window), `node scripts/phase4b-cold-canary.mjs` (live cold release path).
- `node scripts/phase5-native.mjs`, `node scripts/phase5-evm.mjs`, `node scripts/phase5-vault.mjs`, then `node scripts/phase5-report.mjs` → `evidence/attack-log.json` (verdict ALL BLOCKED, bytecode on chain equals the committed source).
- Findings: EVM lane needs a PQ key and a window for every account; classical-only attacker accounts cannot even broadcast. Gaps: stateless-validation refusals in the native sweep, drill zero-balance masking the window check (D-22).

## 17 Nov 2026, Phases 6 and 7.1 to 7.4 ✅
- `node scripts/heartbeat.mjs --dry` / `node scripts/heartbeat.mjs` (rehearsal), `node scripts/test-watchtower.mjs`, `node scripts/watchtower.mjs`, `./scripts/arm.sh`, `node scripts/preflight.mjs --snapshot`, `node scripts/prepare-registration.mjs`.
- Found by rehearsal: gas for the ML-DSA verification, native-lane calls emit no logs, a full disk truncating a file. All three are fixed and logged in `docs/ai-corrections.md`.
