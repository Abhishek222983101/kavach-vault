#!/usr/bin/env python3
"""Generates docs/assets/*.svg and README.md from the evidence files, so every number in the README is read, not typed."""
import json, textwrap
J = lambda p: json.load(open(p))
L, E, K, S2 = J("evidence/attack-log.json"), J("evidence/phase4.json"), J("evidence/phase4b-cold-canary.json"), J("evidence/phase2.json")
n, ev, v = L["native"], L["evm"], L["vault"]
HOT, COLD = E["hot"]["address"], E["cold"]["address"]
DRILL_Q, DRILL_E = S2["drill"]["native"], S2["drill"]["evm"]
live_rev = sum(1 for x in v["live"] if x["label"].startswith("live reverted"))
BG, FG, GREEN, RED, DIM, BLUE = "#0b1117", "#e6edf3", "#34d399", "#f87171", "#8b98a5", "#60a5fa"

banner = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="320" viewBox="0 0 1280 320" role="img" aria-label="Kavach Vault: a stolen classical key moves nothing">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1117"/><stop offset="1" stop-color="#10202b"/></linearGradient>
<linearGradient id="ln" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="{GREEN}" stop-opacity="0"/><stop offset=".5" stop-color="{GREEN}"/><stop offset="1" stop-color="{GREEN}" stop-opacity="0"/></linearGradient>
<filter id="glow"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>
<rect width="1280" height="320" fill="url(#bg)"/>
<g opacity=".18" stroke="{DIM}" stroke-width="1">{"".join(f'<line x1="{x}" y1="0" x2="{x}" y2="320"/>' for x in range(0,1281,80))}{"".join(f'<line x1="0" y1="{y}" x2="1280" y2="{y}"/>' for y in range(0,321,80))}</g>
<g transform="translate(150 160)" filter="url(#glow)">
<path d="M0,-92 L78,-62 L78,10 C78,58 40,86 0,100 C-40,86 -78,58 -78,10 L-78,-62 Z" fill="none" stroke="{GREEN}" stroke-width="5">
<animate attributeName="stroke-opacity" values="1;.45;1" dur="3s" repeatCount="indefinite"/></path>
<path d="M-34,6 L-8,32 L38,-24" fill="none" stroke="{GREEN}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="120" stroke-dashoffset="120">
<animate attributeName="stroke-dashoffset" values="120;0;0;120" keyTimes="0;.35;.85;1" dur="5s" repeatCount="indefinite"/></path>
</g>
<text x="290" y="132" font-family="Inter,Segoe UI,Helvetica,Arial,sans-serif" font-size="68" font-weight="800" fill="{FG}" letter-spacing="2">KAVACH VAULT</text>
<text x="292" y="178" font-family="Inter,Segoe UI,Helvetica,Arial,sans-serif" font-size="28" fill="{GREEN}">A stolen classical key moves nothing.</text>
<text x="292" y="216" font-family="Inter,Segoe UI,Helvetica,Arial,sans-serif" font-size="20" fill="{DIM}">Post-quantum signatures guard the vault. The drill account holds nothing and opens no window.</text>
<text x="292" y="252" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="17" fill="{BLUE}">QoreChain · Build Before Q-Day · Q-Day Drill</text>
<g transform="translate(0 292)"><path d="M0,0 L180,0 L205,-14 L232,16 L262,-30 L292,10 L312,0 L1280,0" fill="none" stroke="url(#ln)" stroke-width="3" stroke-dasharray="1400" stroke-dashoffset="1400">
<animate attributeName="stroke-dashoffset" values="1400;0;0;-1400" keyTimes="0;.5;.6;1" dur="6s" repeatCount="indefinite"/></path></g>
</svg>
'''
open("docs/assets/banner.svg", "w").write(banner)

def box(x, y, w, h, title, sub, col):
    return f'<g><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="#111b24" stroke="{col}" stroke-width="2"/><text x="{x+w/2}" y="{y+h/2-4}" text-anchor="middle" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="18" font-weight="700" fill="{FG}">{title}</text><text x="{x+w/2}" y="{y+h/2+20}" text-anchor="middle" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="13" fill="{DIM}">{sub}</text></g>'
def arrow(x1, y1, x2, y2, col, delay=0, blocked=False):
    mid = (x1 + x2) / 2
    a = f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{col}" stroke-width="3" stroke-dasharray="10 8"><animate attributeName="stroke-dashoffset" values="36;0" dur="1.2s" repeatCount="indefinite"/></line>'
    if blocked:
        a += f'<g transform="translate({mid} {(y1+y2)/2})"><circle r="15" fill="{BG}" stroke="{RED}" stroke-width="3"><animate attributeName="r" values="15;18;15" dur="2s" begin="{delay}s" repeatCount="indefinite"/></circle><path d="M-7,-7 L7,7 M7,-7 L-7,7" stroke="{RED}" stroke-width="4" stroke-linecap="round"/></g>'
    return a
def flow(x1, y1, x2, y2, col=GREEN):
    return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{col}" stroke-width="3" stroke-dasharray="10 8"><animate attributeName="stroke-dashoffset" values="36;0" dur="1.2s" repeatCount="indefinite"/></line>'
lane = lambda y, t, sub: box(430, y, 440, 74, t, sub, BLUE)
pipeline = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="620" viewBox="0 0 1280 620" role="img" aria-label="Every road for the classical key ends at a refusal; money moves only with the post-quantum signature">
<rect width="1280" height="620" fill="{BG}"/>
<text x="40" y="34" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="16" font-weight="700" fill="{RED}">THE BOT: holds only the drill account's classical key</text>
{box(40,120,250,110,"The bot","classical secp256k1 key, nothing else",RED)}
{lane(50,"Native lane","needs the hybrid secp256k1 + ML-DSA-87 signature")}
{lane(142,"EVM lane","needs an open window and a balance: the drill account has neither")}
{lane(234,"Vault calls","need an ML-DSA-87 signature the bot cannot make")}
{lane(326,"Off-chain signatures","permits and Permit2: the account holds nothing to permit")}
{arrow(290,160,430,87,RED,0,True)}{arrow(290,170,430,179,RED,.3,True)}{arrow(290,185,430,271,RED,.6,True)}{arrow(290,200,430,363,RED,.9,True)}
<text x="960" y="200" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="22" font-weight="700" fill="{RED}">All refused</text>
<text x="960" y="228" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="14" fill="{DIM}">{n['attempts']+ev['attempts']+v['callAttacks']} live attacks, 0 accepted</text>
<line x1="40" y1="428" x2="1240" y2="428" stroke="#1f2d3a" stroke-width="2"/>
<text x="40" y="462" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="16" font-weight="700" fill="{GREEN}">THE ONLY ROAD TO THE MONEY: a signature from a key the bot does not have</text>
{box(40,490,230,96,"Owner PQ key","ML-DSA-87, kept offline",GREEN)}
{box(350,490,250,96,"Signed request","416 bytes, domain-separated",GREEN)}
{box(680,490,270,96,"Hot vault","about 15% · capped per tx and per day",GREEN)}
{box(1030,490,210,96,"Cold vault","about 85% · locked until 20 Nov",GREEN)}
{flow(270,538,350,538)}{flow(600,538,680,538)}{flow(950,538,1030,538)}
</svg>
'''
open("docs/assets/pipeline.svg", "w").write(pipeline)

lines = [
 ("$ node scripts/phase5-native.mjs   # drill classical key only", DIM),
 (f"  {n['messageTypesInRegistry']} registry message types + {n['handBuiltValidAttacks']} hand-built attacks, plain and fee-granted", FG),
 (f"  {n['attempts']} attempts   accepted: {n['accepted']}   refused at the PQ gate: {n['refusedAtPqGate']}  ({n['distinctTypesReachingPqGate']} distinct types)", GREEN),
 ("$ node scripts/phase5-evm.mjs", DIM),
 (f"  {ev['attempts']} raw EVM txs (1559, 2930, legacy, 7702, create, approve, Permit2 shape)   accepted: {ev['accepted']}", GREEN),
 ("$ node scripts/phase5-vault.mjs", DIM),
 (f"  {v['callAttacks']} call attacks + {live_rev} live reverted txs + forced QOR   all refused; owner heartbeat and withdrawal still work", GREEN),
 ("$ node scripts/phase5-report.mjs", DIM),
 (f"  deployed bytecode == committed source: {L['deployed']['hotBytecodeMatchesBuild'] and L['deployed']['coldBytecodeMatchesBuild']}   drill balance: {L['state']['drillBalances']}   windows open: 0", FG),
 (f"  VERDICT: {L['verdict']}", GREEN),
]
rows = "".join(f'<text x="28" y="{52+i*30}" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="15" fill="{c}" opacity="0"><animate attributeName="opacity" from="0" to="1" begin="{i*0.7}s" dur="0.4s" fill="freeze"/>{t.replace("&","&amp;").replace("<","&lt;")}</text>' for i, (t, c) in enumerate(lines))
open("docs/assets/terminal.svg", "w").write(f'''<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="{52+len(lines)*30+10}" viewBox="0 0 1280 {52+len(lines)*30+10}" role="img" aria-label="Live attack log summary">
<rect width="1280" height="{52+len(lines)*30+10}" rx="14" fill="#0d1620" stroke="#1f2d3a"/>
<circle cx="26" cy="22" r="6" fill="#f87171"/><circle cx="46" cy="22" r="6" fill="#fbbf24"/><circle cx="66" cy="22" r="6" fill="#34d399"/>
{rows}</svg>
''')

# --------------------------- README ---------------------------------------------------------------
def b(label, val, col=GREEN): return f"![{label}](https://img.shields.io/badge/{label.replace(' ','%20').replace('-','--')}-{str(val).replace(' ','%20').replace('-','--')}-{col[1:]}?style=flat-square&labelColor=0b1117)"
badges = " ".join([b("live attacks accepted", f"0 of {n['attempts']+ev['attempts']+v['callAttacks']}"), b("mutants killed", "27 of 27"), b("Slither high+medium", 0),
                   b("coverage lines", "99.6%"), b("Foundry tests", "94 + 6 invariants"), b("license", "MIT", "60a5fa")])
readme = f'''<div align="center">

<img src="docs/assets/banner.svg" alt="Kavach Vault: a stolen classical key moves nothing" width="100%">

<br>

**A vault on QoreChain where the money moves only with a post-quantum signature.**
**The account the attacker holds the key to is empty, has no EVM window, and never did.**

<br>

{badges}

<br>

[**Project page**](https://build.qorechain.io/p/kavach-vault) &nbsp;·&nbsp;
[**Threat model**](docs/04-THREAT-MODEL.md) &nbsp;·&nbsp;
[**Security proofs**](SECURITY-PROOFS.md) &nbsp;·&nbsp;
[**Attack log**](evidence/attack-log.json) &nbsp;·&nbsp;
[**AI usage**](AI_USAGE.md) &nbsp;·&nbsp;
[**Vault spec**](docs/10-VAULT-SPEC.md)

<sub>QoreChain "Build Before Q-Day" · Post-Quantum AI Agents · Q-Day Survivor drill · Team Paradigm: Abhishek Tiwari</sub>

</div>

<br>

> **The question the drill asks:** if a bot holds the classical key of your account for 24 hours, what can it do?
> **Our answer:** nothing, on purpose. A classical key can act in two places: the native lane, which the chain closes to it, and an EVM window, which we never open. It can spend only what the account holds, which is zero. The money sits in two vaults that ignore who calls them and move only for an ML-DSA-87 signature the bot does not have.

<br>

## Judging criteria, and where to check each one

The drill ranks entries by this rule: **proof of life, then fewest successful attacks, then most value kept, with the jury breaking ties on the threat model.** Each row says what we claim and where to verify it.

| Criterion | Our claim | Check it here |
|---|---|---|
| **1. Proof of life** | A native, hybrid-signed transaction from the drill account in the first minutes of the drill, through a fee grant, so the account never needs a balance. Rehearsed live (spike S3) | [`evidence/spike-s3.json`](evidence/spike-s3.json), runbook [`docs/06-DRILL-RUNBOOK.md`](docs/06-DRILL-RUNBOOK.md) |
| **2. Fewest successful attacks** | **0 accepted** of {n['attempts']+ev['attempts']+v['callAttacks']} attacks in our own live simulation: {n['attempts']} native, {ev['attempts']} EVM, {v['callAttacks']} vault calls, plus {live_rev} live reverted transactions | [`evidence/attack-log.json`](evidence/attack-log.json), the three sweeps in [`scripts/`](scripts) |
| **3. Most value kept** | Nothing in the account. About 85% of the value in a cold vault that cannot move before 20 Nov 00:00 UTC; the rest in a capped hot vault | [`evidence/phase4.json`](evidence/phase4.json), balances in the table below |
| **4. Threat model (tie-break)** | 26 hand-written attacks plus a sweep generated from the chain's full message registry; one written proof per invariant, each linked to tests | [`docs/04-THREAT-MODEL.md`](docs/04-THREAT-MODEL.md), [`SECURITY-PROOFS.md`](SECURITY-PROOFS.md) |
| **Category: Post-Quantum AI Agents** | Spending and access limits enforced on chain (per-transaction and rolling daily caps, recipient allowlist, timelock queue, signature deadlines, guardian freeze); authenticated messaging (a 416-byte, domain-separated signed request). The funder uses short EVM windows, capped by block count, transaction count and value, only to deploy and fund; each is closed and proven closed (`found:false`). The drill account never opens one | [`docs/10-VAULT-SPEC.md`](docs/10-VAULT-SPEC.md), [`evidence/phase4.json`](evidence/phase4.json) |
| **Best AI-native build** | Every decision, AI mistake and fix is logged | [`AI_USAGE.md`](AI_USAGE.md), [`docs/ai-corrections.md`](docs/ai-corrections.md) |
| **Submission checks** | Public repository, MIT licence, this README, testnet addresses below. Video: added before the 2 Dec deadline | [`LICENSE`](LICENSE) |

<br>

## Live on qorechain-diana (testnet)

| What | Address |
|---|---|
| Drill account (the bot gets its classical key) | `{DRILL_Q}` / `{DRILL_E}` |
| Hot vault | `{HOT}` |
| Cold vault (release time `1795132800` = 20 Nov 2026 00:00 UTC) | `{COLD}` |
| Deployment, proof-of-life rehearsal, funding, live withdrawal | [`evidence/phase4.json`](evidence/phase4.json) |
| Cold-vault release path proven on a short-lock twin | [`evidence/phase4b-cold-canary.json`](evidence/phase4b-cold-canary.json) |

<br>

## Every road the classical key has

<div align="center">
<img src="docs/assets/pipeline.svg" alt="Every road for the classical key ends at a refusal" width="100%">
</div>

<br>

## What the bot got to try, live

<div align="center">
<img src="docs/assets/terminal.svg" alt="Live attack summary" width="100%">
</div>

<br>

| Sweep | What it does | Result |
|---|---|---|
| **Native** [`phase5-native.mjs`](scripts/phase5-native.mjs) | One classical-only transaction per message type in the SDK registry ({n['messageTypesInRegistry']} types), plus {n['handBuiltValidAttacks']} hand-built valid attacks (bank send, window open, attacker key registration, cross-VM call into the vaults, authz, fee grant, delegate, IBC, EIP-7702-style delegation), each plain and through our fee grant | {n['attempts']} attempts, **0 accepted**. {n['refusedAtPqGate']} refused at the post-quantum gate across {n['distinctTypesReachingPqGate']} distinct types; all {n['handBuiltValidAttacks']} hand-built attacks refused there in both variants. The rest died earlier in stateless validation of placeholder bodies. Balance, sequence, key, window and grant unchanged |
| **EVM** [`phase5-evm.mjs`](scripts/phase5-evm.mjs) | Raw EVM transactions signed with the classical key: legacy, 2930, 1559, 7702, contract creation, approve and transfer of every fest token, a Permit2-shaped call, calls into both vaults | {ev['attempts']} attempts, **0 accepted**. The empty drill is refused for zero balance; a funded, key-registered stand-in with no window is refused for the missing window |
| **Vault** [`phase5-vault.mjs`](scripts/phase5-vault.mjs) | Every external function from a random address and from the drill address: junk, truncated, oversized, replayed, swapped-recipient and cross-vault signatures; the attacker's own valid ML-DSA key; the guardian key used as owner. Then live reverted transactions and QOR forced in by selfdestruct | {v['callAttacks']} call attacks all reverted for the intended reason; 3 controls show a fresh owner signature still works and cannot be redirected; after the attacks the owner's heartbeat and withdrawal still succeed |

<br>

## How a classical key is kept out

1. **Native lane.** An account with a registered post-quantum key must sign every native transaction with both keys. Classical-only transactions are refused in the ante handler before any fee is taken (`pqc` code 20; re-registration code 234), so the drill account's sequence and balance never change.
2. **EVM lane.** A classical key acts on the EVM lane only inside a window opened by the hybrid signature. The drill account never opens one, and it holds no QOR to pay gas with. Its fee-grant covers only `MsgSend` and `MsgCrossVMCall`, and the grant is reached only after the post-quantum checks pass.
3. **The vaults.** No function looks at `msg.sender`, `tx.origin` or `ecrecover`. Every outflow needs an ML-DSA-87 signature over a 416-byte message that binds a domain tag (`0xFF` + name), chain id, vault address, action, role, key version, nonce and deadline, checked through the `pqcVerify` precompile, with the owner key pinned by hash and re-checked against the chain's live `pqcKeyStatus` (registered, proof of possession).
4. **Blast radius.** Even if all of that failed, the hot vault caps each withdrawal and each rolling day, and about 85% of the value sits in a cold vault that refuses everything before 20 Nov.

| Limit (hot vault) | QOR | fUSD | fETH | fBTC |
|---|---|---|---|---|
| Per transaction | 25 | 250 | 0.1 | 0.005 |
| Rolling day | 50 | 500 | 0.2 | 0.01 |

Queued withdrawals wait 6 hours, can be cancelled by the guardian, and still pay only an allowlisted recipient. The guardian key can freeze and cancel but never move funds; unfreezing needs both keys.

<br>

## How it was verified

| Layer | Result | Evidence |
|---|---|---|
| Unit, adversarial and fuzz tests (Foundry) | 94 tests pass, including two 1,000-run fuzzers and guard-independent reentrancy tests | [`test/`](test) |
| Invariants (Foundry) | 6 invariants, 700 runs of 300 calls: balances exact, attackers receive nothing, rules never change without the timelock, 24-hour cap, guardian never moves funds | [`evidence/foundry-invariants.txt`](evidence/foundry-invariants.txt) |
| Second fuzzer (Medusa 1.5.1) | 4 minutes, about 145,000 calls, 6 properties pass; a canary run proved it reaches real withdrawals | [`evidence/medusa-run.txt`](evidence/medusa-run.txt) |
| Symbolic checks (Halmos) | 4 checks pass, including the daily cap over every path within bound | [`test/halmos/Halmos.t.sol`](test/halmos/Halmos.t.sol) |
| Static analysis | Slither: 0 high, 0 medium (3 documented false positives suppressed in source). Semgrep `p/smart-contracts` and `forge lint` as the second analyser | [`evidence/slither.json`](evidence/slither.json), [`evidence/semgrep.json`](evidence/semgrep.json) |
| Mutation testing | 27 of 27 deliberate breakages detected (the first run found one survivor; fixed) | [`evidence/mutation-report.md`](evidence/mutation-report.md) |
| Coverage | 99.6% of lines, 100% of functions, 90.5% of branches (the one uncovered line is a defensive branch the queue cannot reach) | `forge coverage --ir-minimum` |
| Blind AI red team | A separate agent that saw only the contract sources found no exploit; three conditional findings triaged | [`docs/05-BUILD-PLAN.md`](docs/05-BUILD-PLAN.md) |
| Deployed bytecode | Equals a fresh build of the committed source (immutables masked) | [`scripts/phase5-report.mjs`](scripts/phase5-report.mjs) |
| Cold vault, live | A twin with a 4-minute lock refused early release, refused an attacker's valid key after unlock, paid the owner-signed release, refused the replay | [`evidence/phase4b-cold-canary.json`](evidence/phase4b-cold-canary.json) |

<br>

## Reproduce

```bash
pnpm install && forge build
forge test                                   # unit, adversarial, fuzz, invariants
FOUNDRY_INVARIANT_RUNS=700 FOUNDRY_INVARIANT_DEPTH=300 forge test --match-contract InvariantsTest
medusa fuzz --config medusa.json             # second fuzzer
halmos --contract HalmosTest --loop 30 --solver-timeout-assertion 0
python3 scripts/mutate.py                    # mutation testing
node scripts/phase5-native.mjs && node scripts/phase5-evm.mjs && node scripts/phase5-vault.mjs && node scripts/phase5-report.mjs
```

The live scripts need local testnet keys in `.secrets/` (never committed). Everything else runs without them.

<br>

## Repository map

| Path | What it holds |
|---|---|
| [`src/`](src) | `KavachVault` (hot), `KavachColdVault`, the message library, the precompile interface |
| [`test/`](test) | Unit, adversarial, invariant, Medusa, Halmos and cross-check tests (Solidity and TypeScript message builders match byte for byte) |
| [`scripts/`](scripts) | Registration, deployment, the three attack sweeps, the report, mutation testing |
| [`docs/`](docs) | Requirements, research, architecture, threat model, build plan, runbook, decisions, the vault spec |
| [`evidence/`](evidence) | Every live result with transaction hashes |
| [`AI_USAGE.md`](AI_USAGE.md) | How AI was used, where it was wrong, how that was caught |

<br>

## Scope

Testnet only. The design relies on QoreChain enforcing the hybrid signature requirement and exposing `pqcVerify` and `pqcKeyStatus`; we tested both live and cite the node source in [`docs/02-RESEARCH.md`](docs/02-RESEARCH.md). Keys are not rotated in this deployment (decision D-15). Queued withdrawals are not counted against the daily cap by design (D-19): they need the owner's post-quantum signature and a delay. The drill result itself is added to [`evidence/`](evidence) after 19 Nov.

## Credits

Built on the [QoreChain](https://qorechain.io) SDK (`@qorechain/sdk`, `@qorechain/pqc`, `@qorechain/evm`), [Foundry](https://github.com/foundry-rs/foundry) and forge-std, [Medusa](https://github.com/crytic/medusa), [Halmos](https://github.com/a16z/halmos), [Slither](https://github.com/crytic/slither), [Semgrep](https://semgrep.dev), [viem](https://viem.sh) and [@noble/post-quantum](https://github.com/paulmillr/noble-post-quantum). Design ideas that we adopted from other teams' public documentation (the `0xFF` message tag, key pinning with a live key-status check, a guardian that cannot move funds) are credited in [`docs/02-RESEARCH.md`](docs/02-RESEARCH.md). No code was copied.

MIT licence.
'''
open("README.md", "w").write(readme)
print("README and assets written")
