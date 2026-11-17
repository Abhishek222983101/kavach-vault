#!/usr/bin/env bash
# Proves whether this laptop keeps running with the lid closed.
#   ./scripts/lid-test.sh start    begins writing a timestamp every second
#   (close the lid for about 60 seconds, then open it)
#   ./scripts/lid-test.sh check    reports the longest gap: under 5 seconds means it never slept
#   ./scripts/lid-test.sh stop
case "${1:-}" in
  start) rm -f /tmp/lidtest.log; nohup bash -c 'while true; do date +%s >> /tmp/lidtest.log; sleep 1; done' >/dev/null 2>&1 & echo $! > /tmp/lidtest.pid; echo "Started. Close the lid for about 60 seconds, open it, then run: ./scripts/lid-test.sh check";;
  check) python3 - <<'PY'
ts=[int(x) for x in open('/tmp/lidtest.log').read().split()]
gaps=[b-a for a,b in zip(ts,ts[1:])]
m=max(gaps) if gaps else 0
print(f"{len(ts)} samples, longest gap {m} s")
print("PASS: the laptop kept running the whole time" if m<5 else f"FAIL: the laptop was asleep for about {m} s; the automation would have paused")
PY
  ;;
  stop) kill "$(cat /tmp/lidtest.pid 2>/dev/null)" 2>/dev/null; rm -f /tmp/lidtest.pid; echo stopped;;
  *) echo "usage: $0 start|check|stop";;
esac
