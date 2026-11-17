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
  const ob = (await rest(`/cosmos/bank/v1beta1/balances/${cfg.outer.address}`)).body.balances ?? [];
  s.outerBalances = ob.length; s.outerUqor = ob.filter((x) => x.denom === "uqor").reduce((a, x) => a + BigInt(x.amount), 0n).toString();
  const rec = (await rest(`/qorechain/pqc/v1/account/${cfg.outer.address}`)).body;
  s.pqKey = JSON.stringify(rec.account?.public_key ?? rec.account?.pubkey ?? "").length + ":" + (rec.account?.possession_proven ?? "");
  return s;
}
// Recent transactions sent by the drill account (newest first).
async function recentTxs() {
  for (const q of [`query=${encodeURIComponent(`message.sender='${cfg.outer.address}'`)}&order_by=ORDER_BY_DESC&limit=10`, `events=${encodeURIComponent(`message.sender='${cfg.outer.address}'`)}&order_by=2&limit=10`]) {
    const r = await rest(`/cosmos/tx/v1beta1/txs?${q}`).catch(() => null);
    const list = r?.body?.tx_responses;
    if (Array.isArray(list)) return list.map((t) => ({ hash: t.txhash, height: t.height, time: t.timestamp, code: t.code ?? 0 }));
  }
  return [];
}
// A proof of life is a SUCCESSFUL (code 0) transaction from the drill account inside the drill window. A failed one does not count.
async function findProof() {
  return (await recentTxs()).find((t) => t.code === 0 && Date.parse(t.time) >= START && Date.parse(t.time) < END) ?? null;
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
  if (base.drillUqor && BigInt(s.outerUqor) < BigInt(base.drillUqor)) crit.push(`the drill account's QOR fell ${base.drillUqor} -> ${s.outerUqor} uqor`);
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
  // Pre-signed set (all from the drill account, fee paid by the grant):
  //   HB_0   vault heartbeat, account sequence b, vault owner nonce n        (the preferred proof: shows the vault works)
  //   PING_0 plain ping,      account sequence b                            (no vault nonce: cannot be blocked by someone copying HB_0's signature)
  //   PING_1 plain ping,      account sequence b+1                          (used if HB_0 landed but failed, which still uses sequence b)
  const now = Date.now(), seqDelta = Number(BigInt(s.outerSeq) - BigInt(base.outerSeq));
  const proof = await findProof();
  out.proofLanded = !!proof;
  const preDrillMove = seqDelta > 0 && !proof && (await recentTxs()).some((t) => Date.parse(t.time) < START && Date.parse(t.time) > Date.parse(cfg.createdAt));
  if (preDrillMove) { out.issues.push("critical: the drill account sent a transaction before the drill, after pre-signing; the blobs are stale (re-run scripts/refresh-cloud.sh)"); await notify("critical", "pre-signed proof transactions are stale (the drill account sent a transaction before the drill). Send the heartbeat from the laptop, or run scripts/refresh-cloud.sh"); }
  if (!proof && !preDrillMove && now >= START + 120000 && now < END) {
    const nonceMoved = BigInt(s.ownerNonce) !== BigInt(base.ownerNonce);
    const plan = seqDelta === 0 ? (nonceMoved ? ["PING_0"] : ["HB_0", "PING_0"]) : seqDelta === 1 ? ["PING_1"] : [];
    if (!plan.length) { out.issues.push(`critical: the drill account's sequence moved by ${seqDelta} with no successful proof; no pre-signed transaction fits`); await notify("critical", "no pre-signed proof fits the drill account's state; run on the laptop: node scripts/heartbeat.mjs --until-confirmed"); }
    for (const name of plan) {
      const b = blob(name, name.toLowerCase().replace("_", "-") + ".b64"); // HB_0 -> hb-0.b64, PING_1 -> ping-1.b64
      if (!b) { out.issues.push(`warn: blob ${name} not available`); continue; }
      const r = await broadcast(b); out.actions.push({ proofAttempt: name, ...r });
      if (DRY) break;
      if (r.code !== 0) { out.issues.push(`warn: ${name} refused at broadcast: code ${r.code} ${r.log}`); continue; }
      const t = await included(r.hash);
      if (t && (t.code ?? 0) === 0) { out.proofLanded = true; await notify("ok", `PROOF OF LIFE landed from the cloud (${name}): ${r.hash}`); break; }
      out.issues.push(`warn: ${name} was included but failed (code ${t?.code ?? "not found"}); trying the next pre-signed transaction`);
      if (name === "HB_0" && t) { const s2 = await state(); if (Number(BigInt(s2.outerSeq) - BigInt(base.outerSeq)) === 1) { plan.push("PING_1"); } }
    }
  }
  if (out.proofLanded) { out.proof = proof ?? (await findProof()); if (out.proof) out.actions.push({ proofOfLife: out.proof }); }
  if (!out.proofLanded && now > START + 20 * 60000 && now < END) { out.issues.push("critical: 20 minutes into the drill and no proof of life has landed"); await notify("critical", "no proof of life 20 minutes into the drill"); }

  console.log(JSON.stringify(out, null, 1));
  return { code: out.issues.some((i) => i.startsWith("critical")) && !DRY ? 1 : 0, out };

}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await run();
  process.exit(r.code);
}
