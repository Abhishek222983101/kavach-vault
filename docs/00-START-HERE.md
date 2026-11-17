# Kavach Vault: start here

> Q-Day Drill entry and Post-Quantum AI Agents project for **Build Before Q-Day** (QoreChain developer fest).
> Written 17 Nov 2026, ~03:00 IST. Owner: Abhishek Tiwari (Team Paradigm).
> Project page: https://build.qorechain.io/p/kavach-vault

## What this folder is

The single source of truth for the drill build. Humans read this file. The coding agent reads `03-SYSTEM-ARCHITECTURE.md` and works through `05-BUILD-PLAN.md`.

| File | What it holds | Read it when |
|---|---|---|
| `00-START-HERE.md` | The idea in plain language, the timeline, who does what | First |
| `01-REQUIREMENTS.md` | The organisers' rules word for word, and how each one maps to our design | Before changing any design choice |
| `02-RESEARCH.md` | What we verified about the chain, with sources; the competitor field; open questions | When a choice depends on how the chain behaves |
| `03-SYSTEM-ARCHITECTURE.md` | Components, diagrams, message formats, contract design, state machines | While building |
| `04-THREAT-MODEL.md` | Every attack we expect, the layer that stops it, the test that proves it | While building and before registering |
| `05-BUILD-PLAN.md` | Phases and sub-phases, hardest first, with acceptance checks | While building (live checklist) |
| `06-DRILL-RUNBOOK.md` | Minute-by-minute plan for registration and drill day | 17 Nov evening and 18 Nov |
| `07-AI-WORKFLOW.md` | How we use AI to build and verify, and how that becomes `AI_USAGE.md` | Before the build starts |
| `08-DECISIONS.md` | Every locked decision, its evidence and who approved it | Before reversing anything |
| `09-TIE-BREAK-DOSSIER.md` | What the jury reads if several teams survive, and how we win that | Before registering, then after the drill |
| `10-VAULT-SPEC.md` | Exact contract spec: functions, byte layout, defaults, errors, test names | While writing the contract |
| `11-BUILD-PROMPT.md` | The prompt to paste at the start of every build session | Start of each session |
| `99-archive/` | Superseded drafts | Never, unless checking history |

Truth labels used everywhere:
- **[DOC]** stated in QoreChain's official docs (page linked).
- **[CODE]** read in QoreChain's public source code (file linked).
- **[OBSERVED]** we saw it on the testnet ourselves.
- **[TEST]** must be confirmed on the testnet before we rely on it.
- **[ASSUMED]** our inference, not yet confirmed.

## The idea in plain language

Every QoreChain account has **two keys**:
1. A **normal key** (secp256k1, the same kind Ethereum uses). A future quantum computer could work it out from public data.
2. A **post-quantum key** (ML-DSA-87). A quantum computer is not expected to break it.

The drill pretends Q-Day has arrived. On **18 Nov** the organisers give a robot thief the **normal key** of our drill account and let it try everything that key can do for 24 hours. The five projects that keep working and lose the least win **$200 each**.

Our answer, in three sentences:
- **The thief gets a key to an empty room.** The drill account holds nothing, so there is nothing to steal or burn.
- **The money sits in a vault that ignores who is calling.** Money leaves only when the post-quantum key signs the exact request, and the thief does not have that key.
- **We prove all of this in public.** Our own attack bot, a written proof for every claim, and a live log that the jury can check on the explorer.

## Why we can beat teams that look more complete

Most strong entries keep an EVM "window" open on their account or a balance in it. A window is the only place a stolen normal key can act, and a balance is the only thing a key can waste on fees. We do neither. Details and evidence: `02-RESEARCH.md` §3 and §4.

## Timeline (IST)

| When | What |
|---|---|
| 17 Nov, now → 12:00 | Spikes: fee-burn test, fee-grant test, native call into the vault (Phase 1) |
| 17 Nov, 12:00 → 20:00 | Vault, tests, attack bot, deploy (Phases 2–5) |
| 17 Nov, 20:30 → 21:30 | Workshop 2 (you attend) |
| 17 Nov, by 23:30 | Pre-registration checklist green, you paste the key into the project page |
| **18 Nov, 05:29** | **Drill registration closes** (17 Nov 23:59 UTC) |
| **18 Nov, 05:30** | **Drill starts.** Proof-of-life transaction goes out in the first minutes |
| 18 Nov, all day | Watchtower running, evidence collected |
| **19 Nov, 05:29** | **Drill ends** (18 Nov 23:59 UTC) |
| 19 Nov | Proof-of-life hash submitted (if not already), evidence pack published |
| 2 Dec, 23:59 UTC | Main hackathon deadline (repo, video, cover image) |
| 16 Dec | Winners announced. Payouts 17–22 Dec |

## Who does what

| Task | Owner |
|---|---|
| Code, tests, attack bot, docs, deploy scripts | Claude (agent) |
| Sending test QOR from your dashboard wallet to addresses the agent gives you | You |
| Faucet claims (needs your sign-in) for fUSD, fETH, fBTC and daily QOR | You |
| Pasting the drill key and contract addresses into the project page | You |
| Being reachable at 05:30 IST on 18 Nov, or leaving the laptop on | You |
| Approving any GitHub change (repo creation, pushes) | You |

## Secrets rule

Keys and recovery phrases for the throwaway accounts live in `~/kavach-vault/.secrets/` (mode 600, git-ignored). They are never printed, pasted into chat, or committed. The drill account's classical key is the one exception: it goes to the organisers on purpose, and it controls nothing of value.
