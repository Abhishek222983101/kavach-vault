#!/usr/bin/env bash
# Proves the laptop keeps running AND keeps its internet connection with the lid closed.
#   ./scripts/lid-test.sh start    writes a timestamp every second and checks the chain RPC every 5 seconds
#   (close the lid for about 60 seconds, then open it)
#   ./scripts/lid-test.sh check    PASS needs: no gap over 5 s and every network check answered
#   ./scripts/lid-test.sh stop
case "${1:-}" in
  start) rm -f /tmp/lidtest.log /tmp/lidnet.log
    nohup bash -c 'i=0; while true; do date +%s >> /tmp/lidtest.log; i=$((i+1)); if [ $((i%5)) -eq 0 ]; then if curl -s -m 4 -o /dev/null https://rpc-testnet.qore.host/status; then echo "$(date +%s) ok" >> /tmp/lidnet.log; else echo "$(date +%s) fail" >> /tmp/lidnet.log; fi; fi; sleep 1; done' >/dev/null 2>&1 &
    echo $! > /tmp/lidtest.pid; echo "Started. Close the lid for about 60 seconds, open it, then run: ./scripts/lid-test.sh check";;
  check) python3 - <<'PY'
ts=[int(x) for x in open('/tmp/lidtest.log').read().split()]
gaps=[b-a for a,b in zip(ts,ts[1:])]; m=max(gaps) if gaps else 0
net=[l.split()[1] for l in open('/tmp/lidnet.log').read().splitlines() if l.strip()]
fails=net.count('fail')
print(f"{len(ts)} samples, longest gap {m} s; network checks: {len(net)-fails} ok, {fails} failed")
print("PASS: the laptop kept running and kept its connection" if m<5 and fails==0 and net else "FAIL: see above (a gap means it slept, a failed check means the network dropped)")
PY
  ;;
  stop) kill "$(cat /tmp/lidtest.pid 2>/dev/null)" 2>/dev/null; rm -f /tmp/lidtest.pid; echo stopped;;
  *) echo "usage: $0 start|check|stop";;
esac
