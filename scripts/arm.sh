#!/usr/bin/env bash
# Arms the drill-day automation. Safe to run more than once.
#   17 Nov 23:50 UTC (05:20 IST 18 Nov)  watchtower starts and records its baseline
#   18 Nov 00:01 UTC (05:31 IST)         proof-of-life heartbeat, retried until a transaction lands
#   18 Nov every 5 min from 00:05 UTC    re-check; exits at once if already done
#   18 Nov 00:05 UTC (05:35 IST)         the GitHub repository goes public (guarded: refuses before registration closes)
set -euo pipefail
cd "$(dirname "$0")/.."
rm -f evidence/watch-state.json evidence/watch.jsonl evidence/watch.alive evidence/alerts.jsonl   # a fresh baseline for the real run
[ -f evidence/proof-of-life.json ] && { echo "evidence/proof-of-life.json already exists: refusing to arm over a real drill result"; exit 1; }
systemctl --user daemon-reload
for t in kavach-watchtower kavach-heartbeat kavach-heartbeat-retry kavach-heartbeat-extra kavach-go-public; do systemctl --user enable --now "$t.timer"; done
loginctl enable-linger "$USER"
systemctl --user list-timers 'kavach-*' --no-pager
