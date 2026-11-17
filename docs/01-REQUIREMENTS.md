# Requirements, word for word, and traceability

Sources, copied 17 Nov 2026: https://build.qorechain.io/rules and https://build.qorechain.io/start (section 7). The site says rules "may still change until the end of the event", so re-read both pages before registering (`06-DRILL-RUNBOOK.md` checklist item R1).

## 1. Q-Day Drill rules (rules page, verbatim)

> On 18 November 2026, from 00:00 to 23:59 UTC, a bot plays an attacker that has recovered the classical ECDSA key of each drill account and tries everything that key alone can do: native transfers, opening EVM windows, EVM transfers, token approvals and drain calls on the team's contracts.
>
> To take part, a team registers on its project page, before 17 November 23:59 UTC, a testnet account its project uses, with an ML-DSA-87 key registered, together with that account's ECDSA private key and up to five of its contract addresses. Use a fresh testnet account that has never held mainnet funds.
>
> During the drill the team also makes at least one normal transaction from that account and submits its hash, to show the project still works.
>
> Projects are ranked by that proof, then by the fewest successful attacks, then by the most value kept; the jury breaks ties on the threat model.
>
> The five best projects receive the Q-Day Survivor award of $200 each, and the full attack log is published after the drill.

## 2. Start page, section 7 (verbatim)

> On 18 November, a bot plays an attacker who has recovered the classical key of your drill account and tries everything that key alone can do. The five projects that keep working and lose the least win the Q-Day Survivor award.
>
> Pick a testnet account your project uses, a fresh one that has never held mainnet funds, with its ML-DSA-87 post-quantum key registered.
>
> From your project page, register the drill account's classical private key and up to 5 contract addresses to attack. Registration closes on 17 November at 23:59 UTC.
>
> The key you enter goes to the attacker bot and is published after the drill. Never use a key that matters.
>
> During the drill, make a normal transaction from the drill account to show your project still works, and submit its hash on your project page by 19 November.

## 3. What the rules really demand (the gist)

| # | Demand | What it means for us |
|---|---|---|
| G1 | The account must be "a testnet account its project uses" | The drill account must have a real role in Kavach Vault, not be a decoy. It is the vault's **owner identity**: its registered post-quantum key is the key the vault trusts. |
| G2 | ML-DSA-87 key registered on the account | Registered with proof of possession, so `possession_proven: true`. |
| G3 | Fresh account, never held mainnet funds | Generated locally on 17 Nov, testnet only. |
| G4 | Up to 5 contract addresses | The attacker bot targets them. Value in these contracts counts toward "value kept" ([ASSUMED], question Q1). |
| G5 | Proof of life: a normal transaction from the account during the drill, hash submitted by 19 Nov | Rank 1 criterion. Without it we are out. Send it in the first minutes after 05:30 IST on 18 Nov. |
| G6 | Ranking: proof → fewest successful attacks → most value kept → jury on threat model | We must get 0 successful attacks, keep 100% of value, and have the best threat model in case of a tie. |
| G7 | The key is published after the drill | Anyone can try forever after 19 Nov. The design must stay safe with the key public permanently. |

## 4. Main hackathon requirements that touch this project

From the rules and start page (section 6):
- Public GitHub repository with an MIT or Apache-2.0 licence and a README, by 2 Dec 23:59 UTC.
- A video of up to 3 minutes showing the project working (required).
- A 16:9 cover image, at least 1200×675 (optional; generated if missing).
- At least one testnet address the project uses.
- Kits and network features are verified from the repository: only tick what is really in the code.
- Commits must be made during the fest. Install the QoreChain Build GitHub App so commits show in the feed.
- Category: **Post-Quantum AI Agents**: "an autonomous agent with spending and access limits enforced on chain", main requirements "scoped EVM window; transaction, value, duration and target limits; smart-account spending rules; authenticated messaging" (prizes page).
- Best AI-Native Build ($500): "An AI_USAGE.md file documenting the workflow, the generated work and the human contribution."

## 5. Traceability matrix

| Requirement | Design element | Proof we will show | Doc |
|---|---|---|---|
| G1 project uses the account | Vault owner key = drill account's registered ML-DSA-87 key (pinned + live check) | Vault constructor args and `pqcKeyStatus` read on the explorer | 03 §5 |
| G2 key registered | `MsgRegisterPQCKeyV2` with proof of possession | `GET /qorechain/pqc/v1/account/<drill>` shows `possession_proven: true` | 06 checklist |
| G3 fresh account | Generated 17 Nov, never touched mainnet | Account creation height on testnet | 06 checklist |
| G4 contracts | Vault (+ optional decoy-free second contract) | Contract addresses on project page | 03 §5 |
| G5 proof of life | Hybrid-signed native heartbeat, fee paid by a scoped fee grant | Tx hash + explorer link, submitted on the project page | 03 §7, 06 |
| G6 zero attacks, full value | Zero-balance account, no window, signature-gated vault | Attack log (theirs + ours), balances before/after | 04, 09 |
| G6 tie-break | Threat model with a proof and a test per claim | `09-TIE-BREAK-DOSSIER.md`, `SECURITY-PROOFS.md` | 09 |
| G7 key public forever | Same properties hold with no time limit | Invariant tests with the attacker holding the key | 04 |
| Category: on-chain limits | Per-tx cap, rolling daily cap, allowlist, timelock, agent intents | Contract tests | 03 §5 |
| AI-Native award | `AI_USAGE.md` built from the live decision log | `07-AI-WORKFLOW.md` | 07 |
