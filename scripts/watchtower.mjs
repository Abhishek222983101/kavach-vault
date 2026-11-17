// Watchtower: polls the chain every few seconds during the drill, writes one summary line per tick to evidence/watch.jsonl,
// raises alerts, and, on a CRITICAL event against the hot vault, freezes it with the guardian key through a native call
// (no EVM window, no drill-account involvement).
//   node scripts/watchtower.mjs                         real vaults from evidence/phase4.json, 15 s interval, auto-freeze on
//   node scripts/watchtower.mjs --no-freeze             watch and alert only
//   node scripts/watchtower.mjs --vault 0x.. --no-cold --no-drill --interval 4 --state /tmp/w.json --log /tmp/w.jsonl   (used by the test)
// State is read from the chain (balances, nonces, frozen flag), not only from events, because events emitted by calls that
// arrive through the native lane do not appear in eth_getLogs (observed in the heartbeat rehearsal).
import fs from "node:fs";
import { execSync } from "node:child_process";
import * as c from "./lib/chain.mjs";
import { pub } from "./lib/evm.mjs";
import { evidence, hotArt, coldArt, nativeCall, guardianFreezeCalldata, vaultState } from "./lib/ops.mjs";
import { alert } from "./lib/alert.mjs";

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const FREEZE = !flag("--no-freeze"), CHECK_COLD = !flag("--no-cold"), CHECK_DRILL = !flag("--no-drill");
const INTERVAL = Number(opt("--interval", "15")) * 1000;
const STATE = opt("--state", "evidence/watch-state.json"), LOG = opt("--log", "evidence/watch.jsonl");
const ev = evidence("phase4.json");
const HOT = opt("--vault", ev.hot.address), COLD = ev.cold.address;
const DRILL_START = Date.parse("2026-11-18T00:00:00Z"), DRILL_END = Date.parse("2026-11-19T00:00:00Z");

const funder = await c.loadAccount("funder"), drill = await c.loadAccount("drill");
const hotAbi = hotArt().abi;
const withTimeout = (p, ms = 12000) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error("timeout")), ms))]);
const rd = (address, abi, functionName, args = []) => withTimeout(pub.readContract({ address, abi, functionName, args }));

async function snapshot() {
  const s = { at: new Date().toISOString() };
  const head = await withTimeout(pub.getBlock());
  s.height = Number(head.number); s.blockAgeSec = Math.round(Date.now() / 1000 - Number(head.timestamp));
  s.hot = await withTimeout(vaultState(HOT));
  if (CHECK_COLD) s.coldWei = (await withTimeout(pub.getBalance({ address: COLD }))).toString();
  if (CHECK_DRILL) {
    s.drill = { window: (await withTimeout(c.windowRecord(drill.address))).found, balances: await withTimeout(c.allBalances(drill.address)),
      seq: (await withTimeout(c.getJson(`/cosmos/auth/v1beta1/accounts/${drill.address}`))).body.account?.sequence ?? null };
    const rec = await withTimeout(c.pqcRecord(drill.address)); s.drill.pqKey = JSON.stringify(rec.account?.public_key ?? rec.account?.pubkey ?? "").length + ":" + (rec.account?.possession_proven ?? "");
    const g = await withTimeout(c.getJson(`/cosmos/feegrant/v1beta1/allowance/${funder.address}/${drill.address}`));
    s.grantLeftUqor = g.body.allowance?.allowance?.allowance?.spend_limit?.[0]?.amount ?? null;
  }
  s.funder = { window: (await withTimeout(c.windowRecord(funder.address))).found, uqor: (await withTimeout(c.balance(funder.address))).toString() };
  try { s.diskFreeMB = Number(execSync("df -Pm / | tail -1 | awk '{print $4}'").toString().trim()); } catch {}
  return s;
}

let base = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : null;
let frozenByUs = false, failStreak = 0, lastHeight = 0, lastHeightAt = Date.now(), ticks = 0;

async function freezeNow(reason) {
  if (!FREEZE || frozenByUs) return;
  frozenByUs = true;
  await alert("critical", `Freezing the hot vault: ${reason}`);
  try {
    const f = await guardianFreezeCalldata(HOT, 600);
    const r = await nativeCall(funder, HOT, f.data, { gas: 1500000 }); // the funder pays its own fee; no window, no drill account
    const st = await vaultState(HOT);
    await alert(st.frozen ? "ok" : "critical", `Freeze ${st.frozen ? "confirmed" : "FAILED"} (code ${r.deliverCode ?? r.checkCode}, tx ${r.hash})`);
  } catch (e) { await alert("critical", "Freeze attempt threw: " + String(e.message ?? e).slice(0, 160)); frozenByUs = false; }
}

async function tick() {
  ticks++;
  let s;
  try { s = await snapshot(); failStreak = 0; }
  catch (e) {
    failStreak++;
    fs.appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), error: String(e.message ?? e).slice(0, 120), failStreak }) + "\n");
    if (failStreak === 4) await alert("warn", "Chain or RPC unreachable for 4 polls in a row");
    if (failStreak === 20) await alert("critical", "Chain or RPC unreachable for 20 polls in a row");
    return;
  }
  const issues = [];
  const push = (level, text) => { issues.push({ level, text }); };
  if (!base) { base = { at: s.at, hotWei: s.hot.balanceWei, coldWei: s.coldWei ?? null, hotOwnerNonce: s.hot.ownerNonce, hotGuardianNonce: s.hot.guardianNonce, hotSpent: s.hot.spent, drillUqor: s.drill ? String(s.drill.balances.filter((x) => x.denom === "uqor").reduce((a, x) => a + BigInt(x.amount), 0n)) : null, drillPqKey: s.drill?.pqKey ?? null }; fs.writeFileSync(STATE, JSON.stringify(base, null, 2)); await alert("info", "Watchtower baseline recorded"); }

  // ---- critical conditions ----
  if (BigInt(s.hot.balanceWei) < BigInt(base.hotWei)) push("critical", `hot vault balance fell from ${base.hotWei} to ${s.hot.balanceWei} wei`);
  if (BigInt(s.hot.spent) > BigInt(base.hotSpent)) push("critical", `hot vault daily-spend counter rose from ${base.hotSpent} to ${s.hot.spent}`);
  if (CHECK_COLD && s.coldWei && BigInt(s.coldWei) < BigInt(base.coldWei)) push("critical", `COLD vault balance fell from ${base.coldWei} to ${s.coldWei} wei`);
  if (CHECK_DRILL && s.drill.window) push("critical", "an EVM window exists on the drill account");
  if (CHECK_DRILL && base.drillPqKey && s.drill.pqKey !== base.drillPqKey) push("critical", "the drill account's post-quantum key record changed");
  // ---- warnings ----
  if (s.hot.frozen && !frozenByUs) push("warn", "the hot vault is frozen (not by this watchtower)");
  if (BigInt(s.hot.guardianNonce) !== BigInt(base.hotGuardianNonce) && !frozenByUs) push("warn", `guardian nonce moved ${base.hotGuardianNonce} -> ${s.hot.guardianNonce}`);
  if (s.funder.window) push("warn", "the funder has an EVM window open");
  if (CHECK_DRILL) {
    const dq = s.drill.balances.filter((x) => x.denom === "uqor").reduce((a, x) => a + BigInt(x.amount), 0n);
    if (base.drillUqor !== null && base.drillUqor !== undefined && dq < BigInt(base.drillUqor)) push("critical", `the drill account's QOR fell from ${base.drillUqor} to ${dq} uqor (value kept is scored on this)`);
    if (base.drillUqor !== null && base.drillUqor !== undefined && dq > BigInt(base.drillUqor)) { push("info", `the drill account received QOR: ${base.drillUqor} -> ${dq}`); base.drillUqor = String(dq); fs.writeFileSync(STATE, JSON.stringify(base, null, 2)); }
    if (s.drill.balances.some((x) => x.denom !== "uqor")) push("info", `the drill account holds another asset: ${JSON.stringify(s.drill.balances)}`);
  }
  if (CHECK_DRILL && s.grantLeftUqor !== null && BigInt(s.grantLeftUqor) < 500000n) push("warn", `fee grant low: ${s.grantLeftUqor} uqor`);
  if (BigInt(s.funder.uqor) < 3000000n) push("warn", `funder balance low: ${s.funder.uqor} uqor`);
  if (s.blockAgeSec > 90) push("warn", `latest block is ${s.blockAgeSec}s old`);
  if (s.height === lastHeight && Date.now() - lastHeightAt > 120000) push("critical", "the chain has not produced a block for 2 minutes");
  if (s.height !== lastHeight) { lastHeight = s.height; lastHeightAt = Date.now(); }
  if (s.diskFreeMB !== undefined && s.diskFreeMB < 300) push("critical", `disk almost full: ${s.diskFreeMB} MB free`); else if (s.diskFreeMB !== undefined && s.diskFreeMB < 1000) push("warn", `disk low: ${s.diskFreeMB} MB free`);
  if (CHECK_DRILL && Date.now() > DRILL_START + 15 * 60000 && Date.now() < DRILL_END && !(fs.existsSync("evidence/proof-of-life.json") && JSON.parse(fs.readFileSync("evidence/proof-of-life.json", "utf8")).confirmed)) push("critical", "15 minutes into the drill and no proof of life is recorded");
  // owner nonce movement is informational: our own heartbeats move it, and so would a copy of a signed heartbeat
  if (BigInt(s.hot.ownerNonce) !== BigInt(base.hotOwnerNonce)) { push("info", `owner nonce ${base.hotOwnerNonce} -> ${s.hot.ownerNonce}`); base.hotOwnerNonce = s.hot.ownerNonce; fs.writeFileSync(STATE, JSON.stringify(base, null, 2)); }

  fs.appendFileSync(LOG, JSON.stringify({ at: s.at, h: s.height, hotWei: s.hot.balanceWei, coldWei: s.coldWei, frozen: s.hot.frozen, ownerNonce: s.hot.ownerNonce, spent: s.hot.spent,
    drill: s.drill ? { win: s.drill.window, bal: s.drill.balances.length, seq: s.drill.seq } : undefined, grant: s.grantLeftUqor, funderUqor: s.funder.uqor, diskMB: s.diskFreeMB, issues: issues.map((i) => i.level + ":" + i.text) }) + "\n");
  fs.writeFileSync(LOG.replace(/\.jsonl$/, "") + ".alive", new Date().toISOString());
  for (const i of issues) if (i.level !== "info") await alert(i.level, i.text); else console.log("[info]", i.text);
  if (issues.some((i) => i.level === "critical" && /hot vault/.test(i.text))) await freezeNow(issues.filter((i) => i.level === "critical").map((i) => i.text).join("; "));
  if (ticks % 40 === 1) console.log(new Date().toISOString(), `tick ${ticks} h=${s.height} hot=${s.hot.balanceWei} cold=${s.coldWei ?? "-"} issues=${issues.length}`);
}

// Readiness: a freeze must be possible. Simulate it (eth_call) from the funder, without sending.
try {
  const f = await guardianFreezeCalldata(HOT, 300);
  await pub.call({ account: funder.evm, to: HOT, data: f.data });
  console.log("freeze readiness: the guardian freeze request is accepted by the vault (simulated, not sent)");
} catch (e) { await alert("critical", "Freeze readiness check FAILED: " + String(e.shortMessage ?? e.message).slice(0, 160)); if (FREEZE) process.exit(2); }

console.log(`watchtower on: hot ${HOT}${CHECK_COLD ? ", cold " + COLD : ""}; every ${INTERVAL / 1000}s; auto-freeze ${FREEZE ? "ON" : "off"}`);
let busy = false;
const loop = async () => { if (busy) return; busy = true; try { await tick(); } catch (e) { console.error("tick error", e); } busy = false; };
await loop();
setInterval(loop, INTERVAL);
