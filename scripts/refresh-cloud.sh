#!/usr/bin/env bash
# Re-sign the cloud blobs against the CURRENT chain state, upload them as GitHub secrets, and publish the public baseline.
# Run it after ANY transaction from the drill account, the freezer, or an owner action on the vault, and before the drill.
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/presign-cloud.mjs --tag real --count 1 | python3 -c "import sys,json; d=json.load(sys.stdin); print('simulation:', json.dumps(d['simulate']))"
cp .secrets/cloud/real/config.json cloud/config.json
for i in 0 1 2; do gh secret set "HB_$i" < ".secrets/cloud/real/hb-$i.b64"; done
gh secret set FREEZE_TX < .secrets/cloud/real/freeze.b64
for i in 0 1; do gh secret set "PING_$i" < ".secrets/cloud/real/ping-$i.b64"; done
git add cloud/config.json
git -c user.name="Abhishek Tiwari" -c user.email="141759667+Abhishek222983101@users.noreply.github.com" commit -q -m "Refresh the cloud keeper baseline

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" || echo "baseline unchanged"
git push -q origin HEAD:main
gh secret list
./scripts/deploy-vercel-keeper.sh
