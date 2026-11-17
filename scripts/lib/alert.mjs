// Alerts: always a log line; a desktop notification when available; Telegram only if the team configured .secrets/telegram.json
// ({"token": "...", "chatId": "..."}). Messages never contain keys or signatures.
import fs from "node:fs";
import { execFile } from "node:child_process";

const recent = new Map();
export async function alert(level, text) {
  const now = Date.now();
  const key = level + text;
  if (recent.has(key) && now - recent.get(key) < 10 * 60 * 1000 && level !== "critical") return; // dedupe repeats of non-critical messages
  recent.set(key, now);
  const line = { at: new Date(now).toISOString(), level, text };
  try { fs.mkdirSync("evidence", { recursive: true }); fs.appendFileSync(process.env.ALERT_LOG ?? "evidence/alerts.jsonl", JSON.stringify(line) + "\n"); } catch {}
  console.log(`[ALERT ${level.toUpperCase()}] ${text}`);
  process.stdout.write("\x07");
  execFile("notify-send", ["-u", level === "critical" ? "critical" : "normal", `Kavach ${level}`, text], () => {});
  try {
    const t = JSON.parse(fs.readFileSync(".secrets/telegram.json", "utf8"));
    const emoji = { ok: "✅", warn: "⚠️", critical: "🚨", info: "ℹ️" }[level] ?? "";
    await fetch(`https://api.telegram.org/bot${t.token}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: t.chatId, text: `${emoji} Kavach ${level}: ${text}` }), signal: AbortSignal.timeout(10000) });
  } catch {}
}
