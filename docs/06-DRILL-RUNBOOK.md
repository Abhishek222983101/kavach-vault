# Drill runbook (all times IST)

Registration cut-off: **18 Nov 05:29 IST** (17 Nov 23:59 UTC). Drill: **18 Nov 05:30 → 19 Nov 05:29 IST**.

## 1. Before registering (17 Nov, by 23:00)

Every item must be ticked, with the evidence file named. If any item fails, do not register until it is fixed.

| # | Check | How | Evidence |
|---|---|---|---|
| R1 | Rules unchanged since 17 Nov 03:00 | Re-read /rules and /start §7; diff against `01-REQUIREMENTS.md` | note in `08-DECISIONS.md` |
| R2 | Drill key registered with proof of possession | `curl -s $REST/qorechain/pqc/v1/account/<drill>` → `found:true`, `key_type:hybrid`, `possession_proven:true` | `evidence/pre-drill.json` |
| R3 | Drill account empty | `curl -s $REST/cosmos/bank/v1beta1/balances/<drill>` → `[]` | same |
| R4 | No window on drill or funder | `curl -s $REST/qorechain/pqc/v1/evm_window/<addr>` → `found:false` | same |
| R5 | Fee grant live and scoped | `curl -s $REST/cosmos/feegrant/v1beta1/allowance/<funder>/<drill>` shows the allowed messages | same |
| R6 | No authz grants, no authenticators, no 7702 consent on the drill account | REST queries for each | same |
| R7 | Vault funded | Explorer balances for QOR, fUSD, fETH, fBTC | same |
| R8 | Live attack simulation green | `pnpm attack` exit 0 | `evidence/attack-log.json` |
| R9 | Heartbeat dry run landed | `pnpm heartbeat --dry-chain` hash | `evidence/heartbeat-test.json` |
| R10 | Timer installed | `systemctl --user list-timers` shows `kavach-heartbeat` at 05:31 | screenshot |
| R11 | Watchtower running | `pnpm watch` log updating | `evidence/watch.jsonl` |
| R12 | Clock synced | `timedatectl` NTP yes | – |

## 2. Registration (you, 17 Nov 23:00 – 18 Nov 05:00)

1. Open https://build.qorechain.io/p/kavach-vault.
2. In "ECDSA private key of the drill account (hex)", paste the drill classical key. The agent will place it in a file for you; copy it from the file, do not ask for it in chat.
3. In "Contract addresses to attack", paste the vault address (one per line).
4. Click **Register for the drill**. Screenshot the confirmation.
5. Do not register any other account or key.

## 3. Drill day (18 Nov)

| Time | Action | Who |
|---|---|---|
| 05:15 | Laptop on, charger in, network up. Watchtower running. | You |
| 05:30 | Drill starts | – |
| 05:31 | Timer sends the heartbeat. Script prints hash + explorer link. | Script |
| 05:35 | Confirm on explorer; if not landed, run `pnpm heartbeat` by hand; if that fails, `pnpm heartbeat --fallback` | You |
| 05:40 | Submit the hash on the project page (do not wait until the 19th) | You |
| every 2 h | Glance at watchtower alerts | You / script |
| 12:00 | Second heartbeat (extra evidence of continued liveness) | Script |
| 19 Nov 05:29 | Drill ends | – |
| 19 Nov morning | `pnpm evidence --post`; compare with organisers' attack log when published | Agent |

## 4. If something goes wrong

| Symptom | Action |
|---|---|
| Watchtower: a window appeared on the drill account | Should be impossible. Submit the pre-signed guardian freeze; capture evidence; tell the organisers. |
| Watchtower: drill balance > 0 | Someone sent us funds (possibly the bot testing). Leave it; it is not ours to lose, but note it in evidence. |
| Watchtower: vault balance dropped | Freeze immediately (pre-signed); investigate with the attack log. |
| Heartbeat refused | Check grant (`allowance`), clock, RPC. Fallback: funder sends 1 QOR to the drill account, drill sends hybrid `MsgSend` immediately, then returns the rest. |
| Public RPC down | Switch endpoint list; retry with backoff. |

## 5. After the drill

- Publish `evidence/` (attack log, watchtower log, before/after balances) in the repo and link it on the project page.
- Write the results section of `09-TIE-BREAK-DOSSIER.md`.
- Rotate nothing: the drill account stays empty forever; the published key controls nothing.
