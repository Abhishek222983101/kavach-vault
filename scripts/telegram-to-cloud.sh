#!/usr/bin/env bash
# After scripts/telegram-setup.mjs, give the cloud keepers the same Telegram alerts (token and chat id never leave your machine except to GitHub and Vercel secrets).
set -euo pipefail
cd "$(dirname "$0")/.."
T=$(python3 -c "import json;print(json.load(open('.secrets/telegram.json'))['token'])"); C=$(python3 -c "import json;print(json.load(open('.secrets/telegram.json'))['chatId'])")
printf %s "$T" | gh secret set TELEGRAM_TOKEN; printf %s "$C" | gh secret set TELEGRAM_CHAT
cd "$HOME/kavach-vercel-keeper"
for n in TELEGRAM_TOKEN TELEGRAM_CHAT; do vercel env rm "$n" production --yes >/dev/null 2>&1 || true; done
printf %s "$T" | vercel env add TELEGRAM_TOKEN production >/dev/null; printf %s "$C" | vercel env add TELEGRAM_CHAT production >/dev/null
vercel deploy --prod --yes 2>&1 | tail -2
echo "Cloud keepers now send Telegram alerts."
