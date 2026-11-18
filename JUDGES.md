# Reviewing Kavach Vault

This page is for judges and for AI agents reviewing the project. Each claim links to its proof, and section 4 shows how to
check the live state yourself in a few minutes. A machine-readable version is in [`evidence/summary.json`](evidence/summary.json).

## 1. In one paragraph

Kavach Vault keeps an AI agent's money on QoreChain behind a post-quantum signature. Nothing leaves the vault without an
ML-DSA-87 signature from the owner's key, checked on chain with `pqcVerify`; the caller's address grants nothing. For
the Q-Day Drill, the account whose classical key the attacker bot holds never opens an EVM window and holds 1 test QOR
that its classical key alone cannot move. About 85% of the value sits in a cold vault locked until 20 Nov; the rest is in a
hot vault with caps, an allowlist, a timelock queue and a guardian freeze. A watchtower freezes the hot vault on any
anomaly, and a keyless cloud backup made sure the proof of life did not depend on one laptop.

## 2. The drill, criterion by criterion

| Ranking criterion | Our result | Proof |
|---|---|---|
| 1. Proof of life (a normal transaction from the drill account during the drill) | Landed at **00:01:03 UTC**, one minute after the start: tx `80517F8F25FF933772FF9789BFAFA648D5AD9D92C6DE893561C9B4C4CFB129BF`, code 0, sender = drill account. It is a real vault action (the owner's signed heartbeat moved the vault's nonce 19 → 20), not a self-transfer. Accepted on the project page. | [`evidence/proof-of-life.json`](evidence/proof-of-life.json) |
| 2. Fewest successful attacks | Predicted **0**, written down during the drill before the attack log was published | [`docs/12-DRILL-PREDICTIONS.md`](docs/12-DRILL-PREDICTIONS.md) |
| 3. Most value kept (drill account, after ÷ before, worst asset) | The drill account holds **1 QOR and no other asset**, so the share is a defined number. Our own fees come from a scoped fee grant, so they never reduce it. Predicted **100%**. | [`evidence/pre-drill.json`](evidence/pre-drill.json) |
| Jury tie-break: the threat model | Every road a classical key has, with the defence and a live test for each | [`docs/04-THREAT-MODEL.md`](docs/04-THREAT-MODEL.md), [`SECURITY-PROOFS.md`](SECURITY-PROOFS.md) |

## 3. What we did that is easy to miss

| What | Why it matters | Proof |
|---|---|---|
| **We attacked ourselves live before the drill**: 298 native, 34 EVM and 78 vault-call attacks with the drill account's real classical key; 0 accepted | We did not assume the chain's protection works; we measured it, including every message type in the SDK registry and a sweep that tried to burn our fee grant | [`evidence/attack-log.json`](evidence/attack-log.json), [`evidence/attack-native.json`](evidence/attack-native.json), [`evidence/attack-evm.json`](evidence/attack-evm.json), [`evidence/attack-vault.json`](evidence/attack-vault.json) |
| **Predictions written down before the result** | The threat model can be checked against the organisers' attack log, line by line | [`docs/12-DRILL-PREDICTIONS.md`](docs/12-DRILL-PREDICTIONS.md) |
| **A funded drill account, not an empty one** | An empty account makes "value kept" 0 ÷ 0. Ours holds 1 QOR, so it is measurable, and it should stay at 100% | [`evidence/pre-drill.json`](evidence/pre-drill.json) |
| **The proof of life is a vault action** | It shows the project working, not only the account | [`evidence/proof-of-life.json`](evidence/proof-of-life.json) |
| **Watchtower with automatic guardian freeze**, tested: a benign event is ignored; an unauthorised withdrawal on a test vault was frozen in 6 seconds and the next withdrawal refused | Damage is limited in seconds even if an unknown bug appears | [`evidence/watchtower-test.json`](evidence/watchtower-test.json), [`scripts/watchtower.mjs`](scripts/watchtower.mjs) |
| **Keyless cloud backup** on GitHub Actions and Vercel, holding only pre-signed transactions (no private keys) | The proof of life and the freeze did not depend on one laptop. We found and fixed an attack on it: someone copying a heartbeat signature could spend its nonce first, so the backup falls back to pre-signed pings that carry no vault signature (tested) | [`cloud/keeper.mjs`](cloud/keeper.mjs), [`docs/ai-corrections.md`](docs/ai-corrections.md) |
| **Hot and cold split** | 85% of the value cannot move before 20 Nov, whatever happens | [`src/KavachColdVault.sol`](src/KavachColdVault.sol), [`evidence/phase4b-cold-canary.json`](evidence/phase4b-cold-canary.json) |
| **Verification beyond unit tests**: 94 Foundry tests, 6 invariants, Medusa fuzzing, Halmos symbolic checks, Slither and Semgrep (0 high or medium), 27 of 27 mutants killed, about 99.6% line coverage, a blind AI red team | Each claim in the security proofs names the test that checks it | [`SECURITY-PROOFS.md`](SECURITY-PROOFS.md), [`evidence/mutation-report.md`](evidence/mutation-report.md), [`evidence/foundry-invariants.txt`](evidence/foundry-invariants.txt), [`evidence/medusa-run.txt`](evidence/medusa-run.txt), [`evidence/slither.json`](evidence/slither.json) |
| **Mistakes logged openly**: every AI and human mistake found during the build, with how it was caught and fixed | Shows how the work was checked, not only the result | [`docs/ai-corrections.md`](docs/ai-corrections.md), [`AI_USAGE.md`](AI_USAGE.md) |

## 4. Check it yourself

Live state on qorechain-diana (REST `https://api-testnet.qore.host`, EVM RPC `https://evm-testnet.qore.host`):

```bash
DRILL=qor1hk8vnarknzqjd3aa8hcsumxx6l3e6g7zwd2pzp
# drill account balance: expect 1000000 uqor and nothing else
curl -s https://api-testnet.qore.host/cosmos/bank/v1beta1/balances/$DRILL
# no EVM window: expect "found": false
curl -s https://api-testnet.qore.host/qorechain/pqc/v1/evm_window/$DRILL
# post-quantum key registered with proof of possession
curl -s https://api-testnet.qore.host/qorechain/pqc/v1/account/$DRILL
# every transaction the drill account has sent (during the drill: only our proof of life)
curl -s "https://api-testnet.qore.host/cosmos/tx/v1beta1/txs?query=message.sender%3D%27$DRILL%27&order_by=ORDER_BY_DESC&limit=5"
# the proof of life: code 0, sender = drill account
curl -s https://api-testnet.qore.host/cosmos/tx/v1beta1/txs/80517F8F25FF933772FF9789BFAFA648D5AD9D92C6DE893561C9B4C4CFB129BF
# vault balances: expect 129 QOR (hot) and 740 QOR (cold)
for V in 0x10256EDD0877436FfCBA8A62b0598f4bAD01514B 0x3Fc71aF5bADd701FF7D718df932E0dDf8612149F; do
  curl -s -X POST -H 'content-type: application/json' https://evm-testnet.qore.host \
    --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getBalance\",\"params\":[\"$V\",\"latest\"]}"; echo; done
```

The code:

```bash
forge test                  # 94 tests and 6 invariants
node scripts/preflight.mjs  # the full live checklist (needs the team's keys for the signing checks)
```

## 5. Addresses

| What | EVM | Native |
|---|---|---|
| Hot vault | `0x10256EDD0877436FfCBA8A62b0598f4bAD01514B` (deploy tx `0x7b58b47b63b3c12aed8f785196f785c5ba194a5bf690359c163f0aa5854d16a3`) | `qor1zqjkahggwapkll963f3tqkv0fwksz52tcmz3x3` |
| Cold vault | `0x3Fc71aF5bADd701FF7D718df932E0dDf8612149F` (deploy tx `0x3d5a17e72b868d56e469f46609f4a0d971e61bcdda4e5cf6deb4c49355b6bd64`) | `qor18lr34ad6m4cpla7hrr0extsdm7rpy9yl654rtq` |
| Drill account | `0xbd8EC9F476988126C7bd3dF10e6cC6d7e39d23C2` | `qor1hk8vnarknzqjd3aa8hcsumxx6l3e6g7zwd2pzp` |

The deployed bytecode matches a build of the committed source (checked by `scripts/preflight.mjs`).

## 6. Limits, stated plainly

- The protection of the drill account rests on the chain's post-quantum gate. We tested it live, but it is the chain's code, not ours.
- A freeze of the hot vault is a safe state but stops payments until the owner unfreezes it with both keys.
- There is no autonomous AI agent in this repository yet: the vault is the guardrail an agent would spend through.
- Results of the drill itself are added to [`docs/12-DRILL-PREDICTIONS.md`](docs/12-DRILL-PREDICTIONS.md) and [`docs/09-TIE-BREAK-DOSSIER.md`](docs/09-TIE-BREAK-DOSSIER.md) once the organisers publish the attack log.

## 7. Where things are

| Path | What |
|---|---|
| `src/` | the hot and cold vaults (Solidity 0.8.28) |
| `test/` | Foundry tests, invariants, Medusa and Halmos harnesses |
| `scripts/` | deployment, attack sweeps, heartbeat, watchtower, preflight |
| `cloud/` | the keyless cloud keeper |
| `evidence/` | every result file referenced above |
| `docs/` | requirements, research, architecture, threat model, decisions, runbook, predictions |
