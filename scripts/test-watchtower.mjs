// Phase 6.2 acceptance: a simulated anomaly on a TEST vault triggers an alert and a guardian freeze, and a benign event does not.
// Never touches the real vaults.
import fs from "node:fs";
import { spawn } from "node:child_process";
import { encodeFunctionData, parseEther, getAddress, keccak256 } from "viem";
import * as c from "./lib/chain.mjs";
import { openWindow, closeWindow, wallet, pub } from "./lib/evm.mjs";
import { art, FEST, ZERO, guardianKeypair, signRequest, chainNow, ACTION, ROLE, addrWord, uintWord } from "./lib/vault.mjs";
import { nativeCall, ownerHeartbeatCalldata, vaultState } from "./lib/ops.mjs";

const funder = await c.loadAccount("funder"), drill = await c.loadAccount("drill");
const hot = art("KavachVault"); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { at: new Date().toISOString(), steps: [] }; const step = (n, extra = {}) => { out.steps.push({ n, ...extra }); console.log(n, JSON.stringify(extra).slice(0, 200)); };
const TESTFILE = "evidence/test-vault.json";
let T = fs.existsSync(TESTFILE) ? JSON.parse(fs.readFileSync(TESTFILE, "utf8")) : null;
if (!T) {
  const gk = guardianKeypair(); let opened = false;
  try {
    const o = await openWindow(funder, { blocks: 300n, maxTxs: 4n, maxValueUqor: 30_000_000n }); opened = true;
    const w = wallet(funder);
    const lim = [{ perTx: parseEther("2"), daily: parseEther("4") }, { perTx: 10n ** 6n, daily: 10n ** 7n }, { perTx: 10n ** 15n, daily: 10n ** 16n }, { perTx: 10n ** 4n, daily: 10n ** 5n }];
    const h = await w.deployContract({ abi: hot.abi, bytecode: hot.bytecode.object, args: ["0x" + Buffer.from(drill.pqc.publicKey).toString("hex"), drill.evm, keccak256("0x" + Buffer.from(gk.publicKey).toString("hex")), [getAddress(funder.evm)], Object.values(FEST).map((t) => t.address), lim, 3600n] });
    const r = await pub.waitForTransactionReceipt({ hash: h });
    const f = await w.sendTransaction({ to: r.contractAddress, value: parseEther("5") }); await pub.waitForTransactionReceipt({ hash: f });
    T = { address: r.contractAddress, deployTx: h, fundTx: f }; fs.writeFileSync(TESTFILE, JSON.stringify(T, null, 2));
  } finally { if (opened) await closeWindow(funder); }
}
step("test vault", { address: T.address });
const V = T.address;

process.env.ALERT_LOG = "/tmp/wt-alerts.jsonl"; fs.rmSync("/tmp/wt-alerts.jsonl", { force: true }); fs.rmSync("/tmp/wt-state.json", { force: true }); fs.rmSync("/tmp/wt.jsonl", { force: true });
const wt = spawn("node", ["scripts/watchtower.mjs", "--vault", V, "--no-cold", "--no-drill", "--interval", "4", "--state", "/tmp/wt-state.json", "--log", "/tmp/wt.jsonl"], { env: { ...process.env, ALERT_LOG: "/tmp/wt-alerts.jsonl" } });
let wtOut = ""; wt.stdout.on("data", (d) => (wtOut += d)); wt.stderr.on("data", (d) => (wtOut += d));
await sleep(15000);
const st0 = await vaultState(V);
step("baseline", { frozen: st0.frozen, balanceWei: st0.balanceWei, ownerNonce: st0.ownerNonce, readinessLine: /freeze readiness/.test(wtOut) });

// 1) a benign event (the owner's heartbeat, relayed natively) must NOT freeze anything
const hb = await ownerHeartbeatCalldata(V, drill.pqc, 900);
const r1 = await nativeCall(funder, V, hb.data, { gas: 1500000 });
await sleep(14000);
const st1 = await vaultState(V);
step("benign heartbeat", { code: r1.deliverCode ?? r1.checkCode, frozenAfter: st1.frozen, ownerNonce: st1.ownerNonce });
const benignOk = (r1.deliverCode ?? r1.checkCode) === 0 && st1.frozen === false;

// 2) the anomaly: an owner-signed withdrawal the watchtower was not told about
const abi = hot.abi, amt = parseEther("1"), deadline = (await chainNow()) + 900;
const s = await signRequest({ vault: V, abi, kp: drill.pqc, action: ACTION.WITHDRAW, role: ROLE.OWNER, deadline, f: [addrWord(ZERO), addrWord(funder.evm), uintWord(amt)] });
const r2 = await nativeCall(funder, V, encodeFunctionData({ abi, functionName: "withdraw", args: [ZERO, funder.evm, amt, BigInt(deadline), s.pk, s.sig] }), { gas: 1500000 });
step("anomaly: unexpected withdrawal", { code: r2.deliverCode ?? r2.checkCode, tx: r2.hash });
let frozen = false, t0 = Date.now();
while (Date.now() - t0 < 120000) { await sleep(4000); frozen = (await vaultState(V)).frozen; if (frozen) break; }
const reactionSec = Math.round((Date.now() - t0) / 1000);
step("reaction", { frozen, seconds: reactionSec });

// 3) after the freeze, a fresh signed withdrawal must be refused
const d2 = (await chainNow()) + 900;
const s2 = await signRequest({ vault: V, abi, kp: drill.pqc, action: ACTION.WITHDRAW, role: ROLE.OWNER, deadline: d2, f: [addrWord(ZERO), addrWord(funder.evm), uintWord(amt)] });
const refused = await pub.simulateContract({ account: funder.evm, address: V, abi, functionName: "withdraw", args: [ZERO, funder.evm, amt, BigInt(d2), s2.pk, s2.sig] }).then(() => false, () => true);
step("withdrawal after freeze refused", { refused });
wt.kill("SIGTERM"); await sleep(500);
const alerts = fs.existsSync("/tmp/wt-alerts.jsonl") ? fs.readFileSync("/tmp/wt-alerts.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
out.alerts = alerts; out.watchLog = fs.existsSync("/tmp/wt.jsonl") ? fs.readFileSync("/tmp/wt.jsonl", "utf8").trim().split("\n").length : 0;
const criticalSeen = alerts.some((a) => a.level === "critical" && /balance fell|daily-spend/.test(a.text));
const freezeConfirmed = alerts.some((a) => /Freeze confirmed/.test(a.text));
out.result = { benignNoFreeze: benignOk, anomalyDetected: criticalSeen, frozen, reactionSeconds: reactionSec, freezeConfirmedAlert: freezeConfirmed, withdrawalRefusedAfterFreeze: refused };
fs.writeFileSync("evidence/watchtower-test.json", JSON.stringify(out, null, 2));
console.log(out.result);
const ok = Object.values({ ...out.result, reactionSeconds: true }).every(Boolean);
console.log(ok ? "WATCHTOWER TEST PASS" : "WATCHTOWER TEST FAIL"); process.exit(ok ? 0 : 1);
