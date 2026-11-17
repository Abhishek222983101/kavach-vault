// Optional remote alerts. Steps for the person:
//   1. In Telegram, open @BotFather, send /newbot, follow the prompts, copy the token it gives you.
//   2. Open your new bot in Telegram and send it any message (for example "hi").
//   3. Run:  node scripts/telegram-setup.mjs <TOKEN>
// The token is stored in .secrets/telegram.json (mode 600), never committed, and used only to send alert texts to YOU.
import fs from "node:fs";
const token = process.argv[2];
if (!token) { console.error("usage: node scripts/telegram-setup.mjs <bot token>"); process.exit(1); }
const r = await (await fetch(`https://api.telegram.org/bot${token}/getUpdates`)).json();
if (!r.ok) { console.error("Telegram refused the token:", r.description); process.exit(1); }
const chat = [...(r.result ?? [])].reverse().find((u) => u.message?.chat?.id)?.message.chat;
if (!chat) { console.error("No message found. Open your bot in Telegram, send it any message, then run this again."); process.exit(1); }
fs.mkdirSync(".secrets", { recursive: true, mode: 0o700 });
fs.writeFileSync(".secrets/telegram.json", JSON.stringify({ token, chatId: String(chat.id) }), { mode: 0o600 });
const t = await (await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chat.id, text: "✅ Kavach alerts are connected." }) })).json();
console.log(t.ok ? "Connected: a test message was sent to your Telegram." : "Saved, but the test message failed: " + t.description);
