#!/usr/bin/env bash
# Second, independent cloud runner (Vercel cron). Holds the same keyless pre-signed blobs as GitHub (only HB_0 and FREEZE_TX,
# which fit Vercel's 64 KB environment limit). Re-run after scripts/refresh-cloud.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
D="$HOME/kavach-vercel-keeper"; mkdir -p "$D/api"
cp cloud/keeper.mjs "$D/keeper.mjs"; cp cloud/config.json "$D/config.json"
cat > "$D/package.json" <<'J'
{ "name": "kavach-keeper", "private": true, "type": "module", "dependencies": { "viem": "2.57.20" } }
J
cat > "$D/vercel.json" <<'J'
{ "functions": { "api/cron.mjs": { "maxDuration": 60 } },
  "crons": [ { "path": "/api/cron", "schedule": "30 0 * * *" }, { "path": "/api/cron", "schedule": "30 12 * * *" } ] }
J
cat > "$D/api/cron.mjs" <<'J'
import { run } from "../keeper.mjs";
export default async function handler(req, res) {
  const auth = req.headers["authorization"];
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: "unauthorized" });
  const r = await run({ dry: req.query?.dry === "1" });
  const o = r.out;
  // A scheduled run says so on Telegram, so you can see it worked without opening anything.
  if ((req.headers["user-agent"] || "").includes("vercel-cron") && process.env.TELEGRAM_TOKEN && process.env.TELEGRAM_CHAT) {
    const text = `${r.code === 0 ? "🟢" : "🔴"} Kavach Vercel keeper ran at ${o.at}: ${o.issues.length ? "issues: " + o.issues.join("; ").slice(0, 300) : "all clear"}; proof of life landed: ${o.proofLanded}`;
    try { await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT, text }) }); } catch {}
  }
  res.status(r.code === 0 ? 200 : 500).json({ code: r.code, at: o.at, dry: o.dry, issues: o.issues, proofLanded: o.proofLanded,
    actions: o.actions.map((a) => Object.keys(a)[0] + (a.proofOfLife ? ":" + a.proofOfLife.hash : "")) });
}
J
cd "$D"
vercel link --yes --project kavach-keeper >/dev/null 2>&1 || vercel link --yes --project kavach-keeper
[ -f "$HOME/kavach-vault/.secrets/vercel-cron-secret.txt" ] || { openssl rand -hex 24 > "$HOME/kavach-vault/.secrets/vercel-cron-secret.txt"; chmod 600 "$HOME/kavach-vault/.secrets/vercel-cron-secret.txt"; }
setenv() { vercel env rm "$1" production --yes >/dev/null 2>&1 || true; vercel env add "$1" production < "$2" >/dev/null; }
setenv HB_0 "$HOME/kavach-vault/.secrets/cloud/real/hb-0.b64"
setenv FREEZE_TX "$HOME/kavach-vault/.secrets/cloud/real/freeze.b64"
setenv PING_0 "$HOME/kavach-vault/.secrets/cloud/real/ping-0.b64"
setenv PING_1 "$HOME/kavach-vault/.secrets/cloud/real/ping-1.b64"
setenv CRON_SECRET "$HOME/kavach-vault/.secrets/vercel-cron-secret.txt"
vercel deploy --prod --yes 2>&1 | tail -4
