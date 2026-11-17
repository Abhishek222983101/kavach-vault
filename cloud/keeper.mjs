// Cloud keeper: runs on a GitHub Actions schedule (or locally) with NO private keys.
// It can only do two things, both by broadcasting transactions that were signed beforehand (scripts/presign-cloud.mjs):
//   1. After the drill starts, broadcast the pre-signed proof-of-life heartbeat if no transaction from the drill account has landed yet.
//   2. If a critical anomaly shows on chain, broadcast the pre-signed guardian freeze.
// It also reads public chain state and exits non-zero on a critical condition, so GitHub emails the owner.
//
// Config: cloud/config.json (public numbers and addresses).  Blobs: env HB_0..HB_n and FREEZE_TX (base64), or KEEPER_BLOB_DIR for tests.
// Optional: TELEGRAM_TOKEN, TELEGRAM_CHAT.  Test switches: DRILL_START (ISO time), DRY=1 (never broadcast).
import fs from "node:fs";
import { createPublicClient, http, parseAbi } from "viem";

import { fileURLToPath, pathToFileURL } from "node:url";
const CONFIG = process.env.KEEPER_CONFIG ?? fileURLToPath(new URL("./config.json", import.meta.url));
const cfg = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
let DRY = process.env.DRY === "1";
const START = Date.parse(process.env.DRILL_START ?? "2026-11-18T00:00:00Z"), END = START + 24 * 3600 * 1000;
const base = cfg.baseline;
const abi = parseAbi(["function frozen() view returns (bool)", "function nonces(uint8) view returns (uint256)", "function spentInWindow(address) view returns (uint256)"]);
const evm = createPublicClient({ transport: http(cfg.evmRpc, { timeout: 15000, retryCount: 2 }) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const blob = (name, dirName) => process.env[name] ?? (process.env.KEEPER_BLOB_DIR && fs.existsSync(`${process.env.KEEPER_BLOB_DIR}/${dirName}`) ? fs.readFileSync(`${process.env.KEEPER_BLOB_DIR}/${dirName}`, "utf8").trim() : null);

async function rest(path) {
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(cfg.rest + path, { signal: AbortSignal.timeout(15000) }); return { status: r.status, body: await r.json().catch(() => ({})) }; }
    catch (e) { if (i === 2) throw e; await sleep(1500); }
  }
}
async function notify(level, text) {
  console.log(`[${level}] ${text}`);
  if (process.env.TELEGRAM_TOKEN && process.env.TELEGRAM_CHAT) {
    try { await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT, text: `${{ ok: "✅", warn: "⚠️", critical: "🚨" }[level] ?? ""} Kavach keeper (cloud): ${text}` }), signal: AbortSignal.timeout(10000) }); } catch {}
  }
}
async function broadcast(b64) {
  if (DRY) return { dry: true, hash: "dry-run", code: 0 };
  try {
    const r = await fetch(cfg.rest + "/cosmos/tx/v1beta1/txs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tx_bytes: b64, mode: "BROADCAST_MODE_SYNC" }), signal: AbortSignal.timeout(20000) });
    if (r.status >= 500) throw new Error("REST " + r.status);
    const j = await r.json(); const t = j.tx_response ?? {};
    return { hash: t.txhash, code: t.code ?? 0, log: (t.raw_log ?? j.message ?? "").slice(0, 200) };
  } catch {
    const r = await fetch(cfg.tmRpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "broadcast_tx_sync", params: { tx: b64 } }), signal: AbortSignal.timeout(20000) });
    const j = await r.json(); const x = j.result ?? {};
    return { hash: x.hash, code: x.code ?? (j.error ? -1 : 0), log: (x.log ?? j.error?.data ?? "").toString().slice(0, 200), via: "tendermint-rpc" };
  }
}
async function included(hash) { for (let i = 0; i < 20; i++) { await sleep(2000); const t = await rest(`/cosmos/tx/v1beta1/txs/${hash}`).catch(() => null); if (t?.status === 200 && t.body.tx_response) return t.body.tx_response; } return null; }
async function state() {
  const s = { hotWei: (await evm.getBalance({ address: cfg.hot })).toString(),
    frozen: await evm.readContract({ address: cfg.hot, abi, functionName: "frozen" }),
    spent: (await evm.readContract({ address: cfg.hot, abi, functionName: "spentInWindow", args: ["0x0000000000000000000000000000000000000000"] })).toString(),
    ownerNonce: (await evm.readContract({ address: cfg.hot, abi, functionName: "nonces", args: [1] })).toString() };
  if (cfg.cold) s.coldWei = (await evm.getBalance({ address: cfg.cold })).toString();
  const acct = (await rest(`/cosmos/auth/v1beta1/accounts/${cfg.outer.address}`)).body.account;
  s.outerSeq = String(acct?.sequence ?? acct?.base_account?.sequence ?? "0");
  const fa = (await rest(`/cosmos/auth/v1beta1/accounts/${cfg.freezer}`)).body.account; s.freezerSeq = String(fa?.sequence ?? fa?.base_account?.sequence ?? "0");
  s.outerWindow = (await rest(`/qorechain/pqc/v1/evm_window/${cfg.outer.address}`)).body.found === true;
  s.outerBalances = ((await rest(`/cosmos/bank/v1beta1/balances/${cfg.outer.address}`)).body.balances ?? []).length;
  const rec = (await rest(`/qorechain/pqc/v1/account/${cfg.outer.address}`)).body;
  s.pqKey = JSON.stringify(rec.account?.public_key ?? rec.account?.pubkey ?? "").length + ":" + (rec.account?.possession_proven ?? "");
  return s;
}
async function findProof() {
  for (const q of [`query=${encodeURIComponent(`message.sender='${cfg.outer.address}'`)}&order_by=ORDER_BY_DESC&limit=1`, `events=${encodeURIComponent(`message.sender='${cfg.outer.address}'`)}&order_by=2&limit=1`]) {
    const r = await rest(`/cosmos/tx/v1beta1/txs?${q}`).catch(() => null);
    const t = r?.body?.tx_responses?.[0]; if (t) return { hash: t.txhash, height: t.height, time: t.timestamp, code: t.code };
  }
  return null;
}

export async function run(opts = {}) {
  if (opts.dry !== undefined) DRY = opts.dry;
  const out = { at: new Date().toISOString(), tag: cfg.tag, dry: DRY, actions: [], issues: [] };
  let s;
  try { s = await state(); } catch (e) { out.issues.push("critical: cannot read chain state: " + String(e.message).slice(0, 120)); console.log(JSON.stringify(out)); await notify("critical", "keeper cannot read the chain"); return { code: 1, out }; }
  out.state = s;

  // ---------------- 1. anomalies and the pre-signed freeze ----------------
  const crit = [];
  if (BigInt(s.hotWei) < BigInt(base.hotWei)) crit.push(`hot vault balance fell ${base.hotWei} -> ${s.hotWei}`);
  if (BigInt(s.spent) > BigInt(base.spent)) crit.push(`hot vault spend counter rose ${base.spent} -> ${s.spent}`);
  if (cfg.cold && BigInt(s.coldWei) < BigInt(base.coldWei)) crit.push(`COLD vault balance fell ${base.coldWei} -> ${s.coldWei}`);
  if (s.outerWindow) crit.push("an EVM window exists on the drill account");
  if (s.pqKey !== base.pqKey) crit.push("the drill account's key record changed");
  out.issues.push(...crit.map((c) => "critical: " + c));
  const hotCrit = crit.some((c) => /^hot vault/.test(c));
  if (hotCrit && !s.frozen) {
    const f = blob("FREEZE_TX", "freeze.b64");
    if (!f) { out.issues.push("critical: anomaly but no freeze blob available"); await notify("critical", "anomaly detected and no freeze blob: " + crit.join("; ")); }
    else if (s.freezerSeq !== base.freezerSeq) { out.issues.push("critical: the pre-signed freeze is stale (freezer sequence moved)"); await notify("critical", "pre-signed freeze is stale; freeze by hand. " + crit.join("; ")); }
    else {
      await notify("critical", "freezing the hot vault: " + crit.join("; "));
      const r = await broadcast(f); out.actions.push({ freeze: r });
      if (!DRY) { await included(r.hash); s.frozen = await evm.readContract({ address: cfg.hot, abi, functionName: "frozen" }); }
      await notify(s.frozen || DRY ? "ok" : "critical", `freeze ${s.frozen ? "confirmed" : DRY ? "(dry run)" : "NOT confirmed"} tx ${r.hash} code ${r.code}`);
    }
  }
  if (s.frozen && !hotCrit) out.issues.push("warn: the hot vault is frozen");

  // ---------------- 2. proof of life ----------------
  const now = Date.now(), K = cfg.heartbeatCount;
  // "Landed" means a transaction from the drill account after the drill started. A transaction sent earlier (a rehearsal) moves the
  // sequence too, but it is not a proof of life and it makes the pre-signed heartbeats stale.
  let landed = false, stale = false;
  if (BigInt(s.outerSeq) !== BigInt(base.outerSeq)) {
    const p = await findProof();
    if (p && Date.parse(p.time) >= START) landed = true; else stale = true;
  }
  out.proofLanded = landed;
  if (stale) { out.issues.push("critical: the drill account sent a transaction after the heartbeats were pre-signed; they are stale (re-run scripts/refresh-cloud.sh)"); await notify("critical", "pre-signed heartbeats are stale (the drill account's sequence moved before the drill). Send the heartbeat from the laptop, or run scripts/refresh-cloud.sh"); }
  if (!landed && !stale && now >= START + 120000 && now < END + 3600000) {
    const idx = Number(BigInt(s.outerSeq) - BigInt(base.outerSeq));
    if (BigInt(s.ownerNonce) !== BigInt(base.ownerNonce)) { out.issues.push("critical: the vault's owner nonce moved, the pre-signed heartbeats are stale"); await notify("critical", "pre-signed heartbeats are stale (vault owner nonce moved); send the heartbeat from the laptop: node scripts/heartbeat.mjs --until-confirmed"); }
    else {
      const hb = blob("HB_0", "hb-0.b64");
      if (!hb) out.issues.push("critical: no heartbeat blob available");
      else {
        for (let attempt = 1; attempt <= 3 && !out.proofLanded; attempt++) {
          const r = await broadcast(hb); out.actions.push({ heartbeat: r, attempt });
          if (r.code === 0 && !DRY) {
            await included(r.hash);
            const s2 = await state(); const adv = BigInt(s2.outerSeq) > BigInt(base.outerSeq) && BigInt(s2.ownerNonce) > BigInt(base.ownerNonce);
            if (adv) { out.proofLanded = true; await notify("ok", `PROOF OF LIFE landed from the cloud: ${r.hash}`); }
            else out.issues.push("critical: heartbeat transaction landed but the vault's owner nonce did not move");
          } else if (DRY) { out.proofLanded = false; break; }
          else { out.issues.push(`warn: heartbeat broadcast refused: code ${r.code} ${r.log}`); await sleep(15000); }
        }
      }
    }
  }
  if (landed || out.proofLanded) { out.proof = await findProof(); if (out.proof) out.actions.push({ proofOfLife: out.proof }); }
  if (!out.proofLanded && now > START + 20 * 60000 && now < END) { out.issues.push("critical: 20 minutes into the drill and no proof of life has landed"); await notify("critical", "no proof of life 20 minutes into the drill"); }

  console.log(JSON.stringify(out, null, 1));
  return { code: out.issues.some((i) => i.startsWith("critical")) && !DRY ? 1 : 0, out };

}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await run();
  process.exit(r.code);
}
