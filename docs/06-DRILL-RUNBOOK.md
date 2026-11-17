# Drill runbook (all times IST)

Registration cut-off: **18 Nov 05:29 IST** (17 Nov 23:59 UTC). Drill: **18 Nov 05:30 → 19 Nov 05:29 IST**.

## 1. Before registering (17 Nov, by 23:00)

Run `node scripts/preflight.mjs --snapshot`. It checks everything below, prints ok/WARN/FAIL for each item and writes `evidence/pre-drill.json`. Do not register while any item shows FAIL.

| # | Check | Evidence |
|---|---|---|
| R1 | Rules unchanged since 17 Nov 03:00 (re-read /rules and /start §7; diff against `01-REQUIREMENTS.md`) | note in `08-DECISIONS.md` |
| R2 | Drill key registered with proof of possession | preflight, `evidence/phase2.json` |
| R3 | Drill account empty, no EVM window on drill or funder | preflight |
| R4 | Fee grant limited to `MsgSend` and `MsgCrossVMCall`, at least 3 QOR left | preflight; top up with `node scripts/grant-topup.mjs 8000000` |
| R5 | Both vaults funded, hot not frozen, cold release time 20 Nov, allowlists hold only the funder | preflight |
| R6 | Deployed bytecode equals the committed source | preflight |
| R7 | Live attack sweeps green | `evidence/attack-log.json` (`node scripts/phase5-report.mjs`) |
| R8 | Heartbeat accepted by the vault (simulated) and rehearsal landed | preflight, `evidence/rehearsal-heartbeat.json` |
| R9 | Guardian freeze accepted by the vault (simulated); watchtower test passed | preflight, `evidence/watchtower-test.json` |
| R10 | Timers armed (`./scripts/arm.sh`), linger on, clock synced, 2 GB of disk free, mains power | preflight |

## 2. Registration (a person, 17 Nov 23:00 to 18 Nov 05:00)

1. Run `node scripts/prepare-registration.mjs`. It runs the preflight, writes the drill account's classical key to `.secrets/REGISTRATION-drill-ecdsa-key.txt` (mode 600; never printed) and prints the addresses to paste.
2. Open https://build.qorechain.io/p/kavach-vault and find the Q-Day Drill registration.
3. Paste the single line from the key file into "ECDSA private key of the drill account". Never paste a mnemonic.
4. Paste the two contract addresses (hot and cold), one per line.
5. Submit, screenshot the confirmation, then `shred -u .secrets/REGISTRATION-drill-ecdsa-key.txt`.
6. Do not register any other account or key.

## 3. Drill day (18 Nov, all times IST)

| Time | What happens | Who |
|---|---|---|
| 05:20 | Watchtower starts and records its baseline (timer `kavach-watchtower`) | Script |
| 05:29 | Registration closes | – |
| 05:30 | Drill starts | – |
| 05:31 | Proof-of-life heartbeat (timer `kavach-heartbeat`): a native call from the drill account into the hot vault, fee paid by the grant, retried with a fresh signature every 20 s until it lands; a plain ping is the fallback | Script |
| 05:35 | Retry timer starts (every 5 min, exits at once if done); the GitHub repository goes public (`kavach-go-public`) | Script |
| 05:40 | Read `evidence/proof-of-life.json`, submit `primary.hash` on the project page (deadline 19 Nov, do it now) | You |
| 12:00 and 18:00 | Extra heartbeats (`kavach-heartbeat-extra`) as evidence of continued liveness | Script |
| any time | Alerts: desktop notification, `evidence/alerts.jsonl`, and Telegram if `.secrets/telegram.json` exists | Script |
| 19 Nov 05:29 | Drill ends | – |
| 19 Nov morning | `node scripts/preflight.mjs --post`, `./scripts/disarm.sh`, compare with the organisers' attack log | Agent |

Remote alerts (optional, recommended if you will be away): create a bot with @BotFather, send it any message, then run `node scripts/telegram-setup.mjs <token>`; the watchtower and the heartbeat then message you on every alert.

Manual commands: `node scripts/heartbeat.mjs --until-confirmed`, `node scripts/heartbeat.mjs --dry`, `systemctl --user list-timers 'kavach-*'`, `journalctl --user -u kavach-watchtower -f`.

## 4. If something goes wrong

| Symptom | Action |
|---|---|
| Alert: the hot vault balance fell or its spend counter rose | The watchtower has already frozen the hot vault with the guardian key (a native call from the funder). Read `evidence/alerts.jsonl` and `evidence/watch.jsonl`; the cold vault cannot move. |
| Alert: a window appeared on the drill account, or its key record changed | Should be impossible. Capture `evidence/watch.jsonl`, tell the organisers; the account holds nothing and the vault does not trust it. |
| Alert: the drill account holds a balance | Someone sent it funds (possibly the bot testing). Leave it; note it in the evidence. |
| Heartbeat keeps failing | `node scripts/heartbeat.mjs --dry` shows why (signature, nonce, key status). Check the grant (`preflight`), the clock and the RPC. The script raises gas automatically on "out of gas" and falls back to the Tendermint RPC to broadcast. The last resort (not recommended: it breaks the zero-balance rule) is for the funder to send 1 QOR to the drill account and send a hybrid `MsgSend`. |
| Public RPC down | The scripts retry and fall back to `rpc-testnet.qore.host`; the watchtower warns after 4 failed polls and raises a critical alert after 20. |
| Disk nearly full | The watchtower warns below 1 GB and raises a critical alert below 300 MB; free space at once (a full disk truncated a script file once during this build). |

## 5. After the drill

- Publish `evidence/` (attack log, watchtower log, before/after balances) in the repo and link it on the project page.
- Write the results section of `09-TIE-BREAK-DOSSIER.md`.
- Rotate nothing: the drill account stays empty forever; the published key controls nothing.
