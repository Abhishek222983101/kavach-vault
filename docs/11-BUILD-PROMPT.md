# Build prompt: Kavach Vault for the Q-Day Drill

Paste the block below at the start of every build session, then add one line: `Current phase: 6 and 7 (all sub-phases: 6.1–6.3 and 7.1–7.4). Stop before 7.5 (registration is mine to do) and give me the status, including exactly what I paste and where.`.

It replaces the general hackathon prompt (`~/Documents/templates/build prompt agent x`) for this project. What changed and why is at the end.

---

```
You are building Kavach Vault, our entry for the QoreChain Q-Day Drill (Build Before Q-Day).
Goal: on 18 Nov 2026 (00:00–23:59 UTC) a bot holds our drill account's classical (secp256k1) key and tries
everything that key can do. We must (1) land a proof-of-life transaction early, (2) let zero attacks
succeed, (3) keep 100% of the value, (4) have the best threat model if several teams tie.

SOURCE OF TRUTH (read before coding; re-read the parts for the current phase):
- ~/kavach-vault/docs/00-START-HERE.md        overview, timeline, roles
- ~/kavach-vault/docs/01-REQUIREMENTS.md       the rules word for word
- ~/kavach-vault/docs/02-RESEARCH.md           verified chain behaviour, competitor field, open questions
- ~/kavach-vault/docs/03-SYSTEM-ARCHITECTURE.md design, accounts, lanes, value tiers
- ~/kavach-vault/docs/04-THREAT-MODEL.md       every attack, defence and test id
- ~/kavach-vault/docs/05-BUILD-PLAN.md         phases, sub-phases, acceptance checks (live checklist)
- ~/kavach-vault/docs/10-VAULT-SPEC.md         exact contract spec (wins over the architecture doc)
If the code and a doc disagree, stop and fix one of them before going on. Never let them drift.

HOW TO WORK EACH SUB-PHASE (the loop):
1. PLAN: state the sub-phase goal, the files you will touch, and its acceptance check from 05-BUILD-PLAN.
   List every assumption. Anything marked [ASSUMED] or 🧪 in the docs must be tested before you build on it.
2. VERIFY THE GROUND: for any SDK, precompile or chain behaviour you rely on, read the installed version's
   type definitions in node_modules or prove it on the testnet with a throwaway account. Never rely on memory.
3. BUILD: smallest correct change. No features beyond the spec. No owner shortcuts, no msg.sender or
   ecrecover authority, no upgradeability, no delegatecall, no arbitrary calls.
4. TEST (all must actually run and pass, not "should pass"):
   - unit tests for the new behaviour, with real ML-DSA-87 keys and signatures from @qorechain/sdk
   - the adversarial tests named in 04-THREAT-MODEL for anything this sub-phase touches
   - the full existing test suite (no regressions)
   - for contract changes: Foundry invariants I1–I7, then Medusa on the same properties, Halmos where listed
   - for anything on chain: run it on qorechain-diana and record tx hashes
5. ATTACK IT: before calling it done, switch roles. You are the bot with the classical key and unlimited
   funded accounts. Ask: what can I sign, call, front-run, replay, grief or burn now that this exists?
   Any new path → add it to 04-THREAT-MODEL with a test, then go back to step 3.
   Assume the official bot tries things that are not in our list. Prefer defences that remove whole
   classes of attack over defences against one attack.
6. SECURITY PASS: secrets never printed, logged or committed; .secrets/ mode 600; no window left open
   (query /qorechain/pqc/v1/evm_window for funder and drill → found:false); drill balance still 0.
7. RECORD: tick the sub-phase in 05-BUILD-PLAN with the date and evidence; add decisions to 08-DECISIONS;
   add any AI mistake (wrong assumption, bad test, invented API) and how it was caught to
   docs/ai-corrections.md; add a short entry to docs/build-log.md with commands to reproduce.
8. COMMIT locally with a feature-sized message and the Co-Authored-By line. Do not push to GitHub
   unless Abhishek has approved pushes for this session.
Then move to the next sub-phase without waiting, unless a STOP rule applies.

STOP AND ASK ABHISHEK WHEN:
- a Phase 1 spike result contradicts the design (03/04) — propose the fallback first
- anything needs his wallet, his sign-in (faucet), the project page, GitHub, or a public post
- a test cannot be made to pass without weakening a security property
- the clock passes a checkpoint in 00-START-HERE and the phase is not done (report, give options)

NEVER:
- touch mainnet, or any key/phrase outside ~/kavach-vault/.secrets/
- read or use the files in the local key files outside the project except the Exa key through the exa skill
- open an EVM window on the drill account, give it a balance (beyond its one-time registration fee),
  approvals, grants, authenticators or delegations
- mark something done because it compiles; done means its acceptance check ran green
- copy code from competitor repos (we may learn from their public docs and cite them)

PHASE GATE (end of every phase, all must hold):
- full test suite green; invariant + second-fuzzer runs green for contract phases
- 04-THREAT-MODEL updated; every attack has a test id and status
- the pre-registration checks in 06-DRILL-RUNBOOK §1 that apply so far are green
- a 5-line status for Abhishek: what was built, what was proven (with evidence paths/tx hashes),
  what is still unproven, next phase, time left to the 05:29 IST cut-off

STYLE: plain language in docs and status updates; exact numbers and evidence over adjectives.
```

---

## What changed from the general prompt, and why

| General prompt said | This prompt says | Why |
|---|---|---|
| "use exa, do proper research" | Verify every assumption against installed SDK types or a live testnet spike before building on it | Our risks are chain behaviours that web search cannot settle (fee burn, grants, native calls) |
| "build everything in one loop, don't stop" | A fixed 8-step loop per sub-phase, with explicit STOP rules | Some steps need you (wallet, faucet, page, GitHub); a wrong spike result must change the design, not be pushed through |
| "do security testing after every sub-phase" | Step 5 "attack it" with the bot's capabilities, and new attacks go into the threat model with a test | The drill is an attack contest; the threat model is also the tie-break |
| "best UI/UX, demo in 5 minutes" | Removed for the drill build | The drill is ranked on chain results; UI matters later for the main hackathon video |
| "ML pipeline" | Removed | Not part of this project |
| Context doc for humans | Status line at every phase gate + build log + AI corrections log | Feeds `AI_USAGE.md` (Best AI-Native award) with real evidence |
| No explicit secrets rules | NEVER list: mainnet, your key files, drill-account hygiene | One mistake here (a window, a balance, a leaked phrase) loses the drill |
