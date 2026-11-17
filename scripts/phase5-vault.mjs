// Phase 5.3: attacks on the vaults from third-party addresses. Part A: eth_call attacks (every external function, junk /
// forged / replayed / cross-format signatures, from random addresses and from the drill address). Part B: live attacks
// (reverted transactions, forced QOR via selfdestruct) followed by a liveness check (the owner can still heartbeat and withdraw).
import fs from "node:fs";
import { decodeFunctionData, parseEther, getAddress, toHex } from "viem";
import { generatePqcKeypair } from "@qorechain/sdk";
import * as c from "./lib/chain.mjs";
import { openWindow, closeWindow, wallet, pub } from "./lib/evm.mjs";
import { art, ZERO, signRequest, chainNow, ACTION, ROLE, COLD_DOMAIN, addrWord, uintWord, guardianKeypair } from "./lib/vault.mjs";

const ev = JSON.parse(fs.readFileSync("evidence/phase4.json", "utf8"));
const funder = await c.loadAccount("funder"), drill = await c.loadAccount("drill");
const hot = art("KavachVault"), cold = art("KavachColdVault"), forcer = JSON.parse(fs.readFileSync("out/Handler.sol/Forcer.json", "utf8"));
const H = ev.hot.address, C = ev.cold.address;
const ATT = [getAddress("0x00000000000000000000000000000000000BAD01"), getAddress(drill.evm)]; // random attacker, and the drill account itself
const evil = generatePqcKeypair(), owner = drill.pqc, guardian = guardianKeypair();
const hex = (n, b = 0x5a) => toHex(new Uint8Array(n).fill(b));
const PK = 2592, SIG = 4627;
const bal = async () => ({ hot: (await pub.getBalance({ address: H })).toString(), cold: (await pub.getBalance({ address: C })).toString() });
const before = await bal();

// what the attacker has seen on chain: our real heartbeat and withdrawal calls
const seen = {};
for (const [k, tx] of [["heartbeat", ev.heartbeat.tx], ["withdraw", ev.withdrawal.tx]]) {
  const t = await pub.getTransaction({ hash: tx }); seen[k] = decodeFunctionData({ abi: hot.abi, data: t.input });
}
const [, realTo, realAmt, realDl, realPk, realSig] = [...seen.withdraw.args];
const [hbDl, hbPk, hbSig] = seen.heartbeat.args;
const A = (n, i) => seen.withdraw.args[i];

const rows = [];
const reasonOf = (e) => { try { const n = e.walk?.((x) => x?.data?.errorName)?.data?.errorName; if (n) return n; } catch {} return String(e.shortMessage ?? e.message).slice(0, 90); };
async function mustRevert(label, { to, abi, fn, args, value }) {
  for (const from of ATT) {
    const r = await pub.simulateContract({ account: from, address: to, abi, functionName: fn, args, value }).then(() => ({ ok: true }), (e) => ({ ok: false, why: reasonOf(e) }));
    rows.push({ label, from: from === ATT[0] ? "random" : "drill-address", reverted: !r.ok, why: r.why });
    if (r.ok) console.error("!!! DID NOT REVERT:", label, from);
  }
}
const dl = (await chainNow()) + 3600;
const wd = (to, amt, d, pk, sig, asset = ZERO) => ({ to: H, abi: hot.abi, fn: "withdraw", args: [asset, to, amt, d, pk, sig] });
const FOUND = funder.evm, F5 = (...x) => { const f = [...x]; while (f.length < 5) f.push("0x" + "00".repeat(32)); return f; };
// --- withdraw ---
await mustRevert("withdraw: empty pk and sig", wd(FOUND, 1n, dl, "0x", "0x"));
await mustRevert("withdraw: zero-filled right-length pk/sig", wd(FOUND, 1n, dl, hex(PK, 0), hex(SIG, 0)));
await mustRevert("withdraw: random right-length pk/sig", wd(FOUND, 1n, dl, hex(PK), hex(SIG)));
await mustRevert("withdraw: oversized sig", wd(FOUND, 1n, dl, toHex(owner.publicKey), hex(SIG + 1)));
await mustRevert("withdraw: truncated sig", wd(FOUND, 1n, dl, toHex(owner.publicKey), hex(SIG - 1)));
await mustRevert("withdraw: owner pk + random sig", wd(FOUND, 1n, dl, toHex(owner.publicKey), hex(SIG)));
{ const s = await signRequest({ vault: H, abi: hot.abi, kp: evil, action: ACTION.WITHDRAW, role: ROLE.OWNER, deadline: dl, f: [addrWord(ZERO), addrWord(ATT[0]), uintWord(1n)], crossCheck: false });
  await mustRevert("withdraw: attacker's own valid ML-DSA key and signature, to attacker", wd(ATT[0], 1n, dl, s.pk, s.sig));
  await mustRevert("withdraw: attacker's key, to allowlisted funder", wd(FOUND, 1n, dl, s.pk, s.sig)); }
{ const s = await signRequest({ vault: H, abi: hot.abi, kp: guardian, action: ACTION.WITHDRAW, role: ROLE.GUARDIAN, deadline: dl, f: [addrWord(ZERO), addrWord(FOUND), uintWord(1n)], crossCheck: false });
  await mustRevert("withdraw: guardian key signing a withdrawal (guardian can only freeze/cancel)", wd(FOUND, 1n, dl, s.pk, s.sig)); }
await mustRevert("withdraw: REPLAY of our real withdrawal, identical", wd(realTo, realAmt, realDl, realPk, realSig));
await mustRevert("withdraw: replay with recipient swapped to attacker", wd(ATT[0], realAmt, realDl, realPk, realSig));
await mustRevert("withdraw: replay with larger amount", wd(realTo, realAmt * 20n, realDl, realPk, realSig));
await mustRevert("withdraw: replay with another asset (fUSD)", wd(realTo, realAmt, realDl, realPk, realSig, ev.tokens?.fUSD ? "0x97143B771D34ddb9130b807b135Ae675A5a963CA" : ZERO));
await mustRevert("withdraw: replay with extended deadline", wd(realTo, realAmt, realDl + 99999n, realPk, realSig));
await mustRevert("withdraw: heartbeat signature used as a withdrawal signature", wd(FOUND, 1n, hbDl, hbPk, hbSig));
await mustRevert("withdraw: expired deadline", wd(FOUND, 1n, 1n, realPk, realSig));
await mustRevert("withdraw: amount above per-tx cap, junk signature", wd(FOUND, parseEther("26"), dl, realPk, hex(SIG)));
await mustRevert("withdraw: unlisted asset", wd(FOUND, 1n, dl, realPk, hex(SIG), "0x00000000000000000000000000000000000000AA"));
// --- heartbeat / freeze / unfreeze / cancel / queue / execute ---
await mustRevert("heartbeat: REPLAY of our real heartbeat", { to: H, abi: hot.abi, fn: "heartbeat", args: [hbDl, hbPk, hbSig] });
await mustRevert("heartbeat: junk", { to: H, abi: hot.abi, fn: "heartbeat", args: [dl, hex(PK), hex(SIG)] });
for (const role of [1, 2]) await mustRevert(`freeze role ${role}: junk signature`, { to: H, abi: hot.abi, fn: "freeze", args: [role, dl, hex(PK), hex(SIG)] });
await mustRevert("freeze: owner role with the real heartbeat signature", { to: H, abi: hot.abi, fn: "freeze", args: [1, hbDl, hbPk, hbSig] });
await mustRevert("unfreeze: junk both", { to: H, abi: hot.abi, fn: "unfreeze", args: [dl, hex(PK), hex(SIG), hex(PK), hex(SIG)] });
await mustRevert("cancel: unknown id", { to: H, abi: hot.abi, fn: "cancel", args: ["0x" + "11".repeat(32), 1, dl, hex(PK), hex(SIG)] });
for (const a of [2, 3, 4, 5]) await mustRevert(`queueAction ${a}: junk`, { to: H, abi: hot.abi, fn: "queueAction", args: [a, F5(addrWord(ZERO), addrWord(ATT[0]), uintWord(10n ** 24n)), dl, hex(PK), hex(SIG)] });
await mustRevert("queueAction 1 (withdraw is not queueable)", { to: H, abi: hot.abi, fn: "queueAction", args: [1, F5(), dl, hex(PK), hex(SIG)] });
await mustRevert("execute: unknown id", { to: H, abi: hot.abi, fn: "execute", args: ["0x" + "22".repeat(32)] });
await mustRevert("depositToken: unlisted token", { to: H, abi: hot.abi, fn: "depositToken", args: ["0x00000000000000000000000000000000000000AA", 1n] });
await mustRevert("depositToken: QOR address as token", { to: H, abi: hot.abi, fn: "depositToken", args: [ZERO, 1n] });
// --- cold vault ---
const cr = (to, amt, d, pk, sig, asset = ZERO) => ({ to: C, abi: cold.abi, fn: "release", args: [asset, to, amt, d, pk, sig] });
await mustRevert("cold.release: junk before unlock", cr(FOUND, 1n, dl, hex(PK), hex(SIG)));
await mustRevert("cold.release: our real hot withdrawal calldata replayed on the cold vault", cr(realTo, realAmt, realDl, realPk, realSig));
await mustRevert("cold.release: attacker to attacker", cr(ATT[0], parseEther("700"), dl, toHex(evil.publicKey), hex(SIG)));
await mustRevert("cold.depositToken: unlisted token", { to: C, abi: cold.abi, fn: "depositToken", args: ["0x00000000000000000000000000000000000000AA", 1n] });
// --- raw calldata: unknown selector, fallback with value ---
for (const [label, to] of [["hot", H], ["cold", C]]) for (const from of ATT) {
  const r = await pub.call({ account: from, to, data: "0xdeadbeef", value: 1n }).then(() => true, () => false);
  rows.push({ label: `${label}: unknown selector with value`, from: from === ATT[0] ? "random" : "drill-address", reverted: !r }); if (r) console.error("!!! unknown selector accepted", label);
}
// --- controls: the checks must not be reverting everything. A fresh owner signature works from ANY caller, only toward the allowlisted funder.
const controls = [];
{ const d2 = (await chainNow()) + 3600; const s = await signRequest({ vault: H, abi: hot.abi, kp: owner, action: ACTION.WITHDRAW, role: ROLE.OWNER, deadline: d2, f: [addrWord(ZERO), addrWord(FOUND), uintWord(parseEther("1"))] });
  const okFromAttacker = await pub.simulateContract({ account: ATT[0], address: H, abi: hot.abi, functionName: "withdraw", args: [ZERO, FOUND, parseEther("1"), BigInt(d2), s.pk, s.sig] }).then(() => true, () => false);
  const swapped = await pub.simulateContract({ account: ATT[0], address: H, abi: hot.abi, functionName: "withdraw", args: [ZERO, ATT[0], parseEther("1"), BigInt(d2), s.pk, s.sig] }).then(() => false, () => true);
  const amountBumped = await pub.simulateContract({ account: ATT[0], address: H, abi: hot.abi, functionName: "withdraw", args: [ZERO, FOUND, parseEther("2"), BigInt(d2), s.pk, s.sig] }).then(() => false, () => true);
  controls.push({ label: "CONTROL fresh owner signature relayed by an attacker address pays only the signed allowlisted recipient", ok: okFromAttacker }, { label: "CONTROL same signature, recipient swapped -> reverts", ok: swapped }, { label: "CONTROL same signature, amount changed -> reverts", ok: amountBumped }); }
const partA = { attempts: rows.length, allReverted: rows.every((r) => r.reverted), controlsOk: controls.every((x) => x.ok) };
console.log("Part A:", JSON.stringify(partA), controls.map((x) => x.ok));
const mid = await bal();

// ---- Part B: live ---------------------------------------------------------------------------------
const live = [];
const w = wallet(funder);
let opened = false;
try {
  const o = await openWindow(funder, { blocks: 400n, maxTxs: 14n, maxValueUqor: 20_000_000n }); opened = true;
  // B1 live junk calls: forced gas so they are mined and revert on chain
  const junk = [["hot.withdraw junk", { address: H, abi: hot.abi, functionName: "withdraw", args: [ZERO, ATT[0], 1n, BigInt(dl), hex(PK), hex(SIG)] }],
                ["hot.freeze junk", { address: H, abi: hot.abi, functionName: "freeze", args: [1, BigInt(dl), hex(PK), hex(SIG)] }],
                ["hot.withdraw replay of real signature", { address: H, abi: hot.abi, functionName: "withdraw", args: [realTo, realAmt, realDl, realPk, realSig].length ? [ZERO, realTo, realAmt, realDl, realPk, realSig] : [] }],
                ["cold.release junk", { address: C, abi: cold.abi, functionName: "release", args: [ZERO, ATT[0], parseEther("700"), BigInt(dl), hex(PK), hex(SIG)] }]];
  for (const [label, req] of junk) {
    const hash = await w.writeContract({ ...req, gas: 3_000_000n }); const r = await pub.waitForTransactionReceipt({ hash });
    live.push({ label: `live reverted tx: ${label}`, hash, status: r.status }); if (r.status !== "reverted") throw new Error("expected a revert: " + label);
  }
  // B2 forced QOR through selfdestruct (accounting must not be confused)
  const h = await w.deployContract({ abi: forcer.abi, bytecode: forcer.bytecode.object, args: [H], value: parseEther("1") });
  const rc = await pub.waitForTransactionReceipt({ hash: h }); live.push({ label: "live forced 1 QOR into hot vault via selfdestruct", hash: h, status: rc.status });
  const spentAfterForce = await pub.readContract({ address: H, abi: hot.abi, functionName: "spentInWindow", args: [ZERO] });
  live.push({ label: "spentInWindow unaffected by forced QOR", value: spentAfterForce.toString(), ok: spentAfterForce === parseEther("1") });
  // B3 liveness after the attack: owner heartbeat + withdrawal still work
  let d = (await chainNow()) + 3600;
  let s = await signRequest({ vault: H, abi: hot.abi, kp: owner, action: ACTION.HEARTBEAT, role: ROLE.OWNER, deadline: d });
  let hash = await w.writeContract({ address: H, abi: hot.abi, functionName: "heartbeat", args: [BigInt(d), s.pk, s.sig] });
  let r = await pub.waitForTransactionReceipt({ hash }); live.push({ label: "liveness: owner heartbeat after the attacks", hash, status: r.status });
  d = (await chainNow()) + 3600; const amt = parseEther("1");
  s = await signRequest({ vault: H, abi: hot.abi, kp: owner, action: ACTION.WITHDRAW, role: ROLE.OWNER, deadline: d, f: [addrWord(ZERO), addrWord(FOUND), uintWord(amt)] });
  hash = await w.writeContract({ address: H, abi: hot.abi, functionName: "withdraw", args: [ZERO, FOUND, amt, BigInt(d), s.pk, s.sig] });
  r = await pub.waitForTransactionReceipt({ hash }); live.push({ label: "liveness: owner withdrawal after the attacks", hash, status: r.status });
} finally {
  if (opened) { const cl = await closeWindow(funder); live.push({ label: "funder window closed", ok: cl.windowFoundAfter === false }); }
}
const after = await bal();
const spent = await pub.readContract({ address: H, abi: hot.abi, functionName: "spentInWindow", args: [ZERO] });
const final = {
  "cold vault balance never moved": before.cold === after.cold && mid.cold === after.cold,
  "hot vault balance = before + 1 forced - 1 withdrawn": BigInt(after.hot) === BigInt(before.hot) + parseEther("1") - parseEther("1"),
  "spentInWindow = 2 QOR (two legit withdrawals only)": spent === parseEther("2"),
  "all live attack txs reverted": live.filter((x) => x.label.startsWith("live reverted")).every((x) => x.status === "reverted"),
  "liveness txs succeeded": live.filter((x) => x.label.startsWith("liveness")).every((x) => x.status === "success"),
  "funder window closed, drill window absent, drill empty": live.at(-1).ok && (await c.windowRecord(drill.address)).found === false && (await c.allBalances(drill.address)).length === 0,
  "part A: every attack reverted": partA.allReverted, "part A: controls behave": partA.controlsOk,
};
fs.writeFileSync("evidence/attack-vault.json", JSON.stringify({ at: new Date().toISOString(), before, after, partA, rows, controls, live, final }, null, 2));
console.log(final);
const ok = Object.values(final).every(Boolean);
console.log(ok ? "VAULT SWEEP PASS" : "VAULT SWEEP FAIL"); process.exit(ok ? 0 : 1);
