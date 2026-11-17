// Proof of life: a normal transaction from the DRILL account that shows the project still works.
// It is a native (no EVM window) cross-VM call into the hot vault's heartbeat(), carrying a fresh owner ML-DSA-87 signature,
// with the fee paid by the funder's scoped fee grant, so the drill account never holds a balance.
//   node scripts/heartbeat.mjs --dry              check everything without sending (eth_call of the signed heartbeat)
//   node scripts/heartbeat.mjs                    one attempt
//   node scripts/heartbeat.mjs --until-confirmed  retry (fresh signature each time) until a transaction lands, up to --max-minutes
// Before 18 Nov 00:00 UTC it writes evidence/rehearsal-heartbeat.json; from then on evidence/proof-of-life.json.
import fs from "node:fs";
import { encodeFunctionData } from "viem";
import * as c from "./lib/chain.mjs";
import { pub } from "./lib/evm.mjs";
import { nativeCall, ownerHeartbeatCalldata, evidence, hotArt } from "./lib/ops.mjs";
import { alert } from "./lib/alert.mjs";

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const DRY = flag("--dry"), UNTIL = flag("--until-confirmed"), FORCE = flag("--force");
const MAX_MIN = Number(opt("--max-minutes", "45")), PAUSE_S = Number(opt("--pause", "20"));
const DRILL_START = Date.parse("2026-11-18T00:00:00Z");
const drillTime = Date.now() >= DRILL_START || flag("--assume-drill"); // --assume-drill only for testing the drill-mode code path with --dry
const OUT = drillTime ? "evidence/proof-of-life.json" : "evidence/rehearsal-heartbeat.json";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);

const ev = evidence("phase4.json"), hot = ev.hot.address;
const funder = await c.loadAccount("funder"), drill = await c.loadAccount("drill");
const prior = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : null;
if (drillTime && prior?.confirmed && !FORCE && !DRY) { log("proof of life already confirmed:", prior.primary?.hash ?? prior.fallback?.hash); process.exit(0); }

async function preflight() {
  const problems = [];
  const grant = await c.getJson(`/cosmos/feegrant/v1beta1/allowance/${funder.address}/${drill.address}`);
  const left = BigInt(grant.body.allowance?.allowance?.allowance?.spend_limit?.[0]?.amount ?? "0");
  if (left < 500000n) problems.push(`fee grant nearly exhausted: ${left} uqor left`);
  if ((await c.balance(funder.address)) < 1000000n) problems.push("funder cannot pay fees");
  if ((await c.windowRecord(drill.address)).found) problems.push("the drill account has an EVM window (it must not)");
  if ((await c.allBalances(drill.address)).length) problems.push("the drill account holds a balance (informational: still fine for the proof)");
  return { problems, grantLeftUqor: left.toString() };
}

let GAS = 1500000; // ML-DSA verification is expensive; raised automatically if a run reports out of gas
async function attemptHeartbeat() {
  const hb = await ownerHeartbeatCalldata(hot, drill.pqc, 1800);
  if (DRY) {
    await pub.call({ account: drill.evm, to: hot, data: hb.data }); // throws if the signature, nonce, deadline or key status is not accepted
    return { dry: true, ok: true, nonce: String(hb.nonce) };
  }
  const t0 = Date.now();
  const r = await nativeCall(drill, hot, hb.data, { granter: funder.address, gas: GAS });
  if (/out of gas/i.test(r.log ?? "")) GAS = Math.min(Math.round(GAS * 1.6), 6000000);
  const code = r.deliverCode ?? r.checkCode;
  const res = { hash: r.hash, code, log: (r.log ?? "").slice(0, 200), height: r.height, sentAt: new Date(t0).toISOString(), via: r.via ?? "rest" };
  if (code !== 0) return { ...res, ok: false };
  const abi = hotArt().abi;
  let nonceAfter = BigInt(hb.nonce);
  for (let i = 0; i < 8 && nonceAfter <= BigInt(hb.nonce); i++) { await sleep(1500); nonceAfter = await pub.readContract({ address: hot, abi, functionName: "nonces", args: [1] }); }
  // The vault's owner nonce moving forward is the proof the heartbeat executed (an event is read as extra, informational evidence).
  const head = await pub.getBlockNumber();
  const hbEvent = abi.find((x) => x.type === "event" && x.name === "Heartbeat");
  const logs = await pub.getLogs({ address: hot, fromBlock: head - 40n, toBlock: head, event: hbEvent }).catch(() => []);
  const seen = logs.some((l) => Object.values(l.args ?? {})[0] === BigInt(hb.nonce));
  return { ...res, ok: nonceAfter > BigInt(hb.nonce), ownerNonceBefore: String(hb.nonce), ownerNonceAfter: String(nonceAfter), heartbeatEventSeen: seen };
}

async function attemptPing() {
  const p = JSON.parse(fs.readFileSync("evidence/spike-s3-ping.json", "utf8")).address;
  const abi = JSON.parse(fs.readFileSync("out/SpikePing.sol/SpikePing.json", "utf8")).abi;
  const r = await nativeCall(drill, p, encodeFunctionData({ abi, functionName: "ping" }), { granter: funder.address, gas: 800000 });
  return { hash: r.hash, code: r.deliverCode ?? r.checkCode, log: (r.log ?? "").slice(0, 200), ok: (r.deliverCode ?? r.checkCode) === 0 };
}

const started = Date.now(); const run = { mode: drillTime ? "drill" : "rehearsal", startedAt: new Date(started).toISOString(), attempts: [] };
let confirmed = false, tries = 0;
while (true) {
  tries++;
  let pf; try { pf = await preflight(); } catch (e) { pf = { problems: ["preflight failed: " + String(e.message ?? e).slice(0, 120)] }; }
  if (pf.problems?.length) log("preflight:", pf.problems.join("; "));
  let r;
  try { r = await attemptHeartbeat(); } catch (e) { r = { ok: false, error: String(e.shortMessage ?? e.message ?? e).slice(0, 220) }; }
  run.attempts.push({ n: tries, kind: "vault-heartbeat", ...r });
  log(`attempt ${tries}: vault heartbeat`, JSON.stringify(r).slice(0, 300));
  if (DRY) { process.exit(r.ok ? 0 : 1); }
  if (r.ok) { run.primary = r; confirmed = true; break; }
  if (tries >= 3 && !run.fallback) { // keep the vault retries going, but make sure SOME normal transaction from the account lands
    let f; try { f = await attemptPing(); } catch (e) { f = { ok: false, error: String(e.message ?? e).slice(0, 200) }; }
    run.attempts.push({ n: tries, kind: "fallback-ping", ...f }); log("fallback ping:", JSON.stringify(f).slice(0, 200));
    if (f.ok) { run.fallback = f; confirmed = true; await alert("warn", "Proof of life landed only as a fallback ping; the vault heartbeat is still failing"); if (!UNTIL) break; }
  }
  if (!UNTIL || (Date.now() - started) / 60000 > MAX_MIN) break;
  await sleep(PAUSE_S * 1000);
}
run.confirmed = confirmed; run.finishedAt = new Date().toISOString();
run.secondsAfterDrillStart = drillTime ? Math.round((Date.parse(run.finishedAt) - DRILL_START) / 1000) : null;
const hist = prior?.runs ?? (prior ? [prior] : []);
const first = prior?.confirmed; // the first proof stays the headline hash; later (forced) runs are extra evidence of continued liveness
fs.writeFileSync(OUT, JSON.stringify({ confirmed: confirmed || !!first, primary: first ? prior.primary : run.primary, fallback: first ? prior.fallback : run.fallback, runs: [...hist, run] }, null, 2));
if (confirmed) {
  const h = run.primary?.hash ?? run.fallback?.hash;
  log(`PROOF OF LIFE (${run.mode}):`, h);
  await alert("ok", `Proof of life landed (${run.mode}): ${h}`);
  process.exit(0);
}
await alert("critical", "Proof of life has NOT landed after all retries");
process.exit(1);
