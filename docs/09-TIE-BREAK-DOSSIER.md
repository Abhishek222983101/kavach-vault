# Tie-break dossier

If more than five projects show proof of life, zero successful attacks and full value, "the jury breaks ties on the threat model". This file is what we make them read, and why it should rank first.

## 1. What a jury will compare

| Question a judge asks | Typical strong entry | Ours |
|---|---|---|
| What exactly can the attacker do? | Lists the five named attacks | Attack tree with 26 attacks across both lanes, off-chain signatures, fees and liveness (`04-THREAT-MODEL.md`) |
| Is every claim proven? | Tests, some written proofs | One written proof per invariant, each linked to unit, invariant, fuzz and symbolic checks |
| Was it tested live? | Attack script, some simulated | Every attack broadcast on testnet before registration, with tx hashes and balance deltas |
| Did anything leak at all? | Small window fee budget accepted | **Zero**: no window, empty account; the bot had no lane and nothing to burn |
| Do they understand the chain, not just the contract? | Contract-level threat model | Read the node's ante-handler order; found and closed a fee-burn path others did not document |
| Is it reproducible? | Partly | One command per step; evidence committed |

## 2. The pack we publish

1. `docs/04-THREAT-MODEL.md`: attack tree and table.
2. `SECURITY-PROOFS.md`: invariants I1–I7, each with a short proof and links to tests.
3. `evidence/attack-log.json`: our live simulation, every row BLOCKED with tx hash.
4. `evidence/pre-drill.json`, `evidence/post-drill.json`: balances, key record, window state.
5. `evidence/watch.jsonl`: watchtower log through the drill.
6. Comparison with the organisers' published attack log, attack by attack.
7. A one-page summary for judges at the top of the README.

## 3. Results (filled after the drill)

| Metric | Value |
|---|---|
| Proof-of-life hash | – |
| Bot attempts against us (from their log) | – |
| Successful attacks | – |
| Value at start / end | – |
| Fees lost by the drill account | – |
