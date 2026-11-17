// Phase 4: deploy cold + hot vaults, live signed heartbeat, fund, live withdrawal, close windows. Idempotent via evidence/phase4.json.
import fs from "node:fs";
import { parseEther, getAddress } from "viem";
import * as c from "./lib/chain.mjs";
import { openWindow, closeWindow, wallet, pub } from "./lib/evm.mjs";
import { art, FEST, ZERO, guardianKeypair, signRequest, chainNow, ACTION, ROLE, addrWord, uintWord, erc20Abi } from "./lib/vault.mjs";

const EVID = "evidence/phase4.json";
const ev = fs.existsSync(EVID) ? JSON.parse(fs.readFileSync(EVID, "utf8")) : { steps: [] };
const save = () => fs.writeFileSync(EVID, JSON.stringify(ev, null, 2));
const log = (step, extra = {}) => { ev.steps.push({ at: new Date().toISOString(), step, ...extra }); console.log(step, JSON.stringify(extra).slice(0, 300)); save(); };
const COLD_QOR = process.env.COLD_QOR ?? "740", HOT_QOR = process.env.HOT_QOR ?? "130";
const RELEASE_TIME = 1795132800n; // 20 Nov 2026 00:00:00 UTC (round-trip checked)

const funder = await c.loadAccount("funder"), drill = await c.loadAccount("drill");
const gk = guardianKeypair();
const hot = art("KavachVault"), cold = art("KavachColdVault");
const w = wallet(funder);
const owner = drill.pqc;
const guardianHash = (await import("viem")).keccak256("0x" + Buffer.from(gk.publicKey).toString("hex"));
const recipients = [getAddress(funder.evm)];
const tokens = Object.values(FEST).map((t) => t.address);
const limits = [
  { perTx: parseEther("25"), daily: parseEther("50") },                 // QOR
  { perTx: 250n * 10n ** 6n, daily: 500n * 10n ** 6n },                  // fUSD
  { perTx: parseEther("0.1"), daily: parseEther("0.2") },                // fETH
  { perTx: 5n * 10n ** 5n, daily: 10n ** 6n },                           // fBTC (0.005 / 0.01)
];
const DELAY = 6 * 3600;

// Pre-flight: nothing may be wrong before we touch the chain
const rec = await c.pqcRecord(drill.address);
if (!(rec.found && rec.account?.possession_proven)) throw new Error("drill key not registered with proof of possession");
if ((await c.allBalances(drill.address)).length) throw new Error("drill account is not empty");
if ((await c.windowRecord(drill.address)).found) throw new Error("drill has an EVM window");
if ((await c.balance(funder.address)) < BigInt(Math.round((Number(COLD_QOR) + Number(HOT_QOR) + 20) * 1e6))) throw new Error("funder balance too low");

let opened = false;
try {
  const o = await openWindow(funder, { blocks: 1500n, maxTxs: 16n, maxValueUqor: 1_000_000_000n });
  if ((o.deliverCode ?? o.checkCode) !== 0) throw new Error("window open failed: " + o.log);
  opened = true; log("window opened", { hash: o.hash });

  // 4.1 deploy
  if (!ev.cold) {
    const hash = await w.deployContract({ abi: cold.abi, bytecode: cold.bytecode.object, args: [("0x" + Buffer.from(owner.publicKey).toString("hex")), drill.evm, recipients, tokens, RELEASE_TIME] });
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error("cold deploy failed");
    ev.cold = { address: r.contractAddress, tx: hash, block: Number(r.blockNumber) }; log("4.1 deployed cold vault", ev.cold);
  }
  if (!ev.hot) {
    const hash = await w.deployContract({ abi: hot.abi, bytecode: hot.bytecode.object, args: [("0x" + Buffer.from(owner.publicKey).toString("hex")), drill.evm, guardianHash, recipients, tokens, limits, BigInt(DELAY)] });
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error("hot deploy failed");
    ev.hot = { address: r.contractAddress, tx: hash, block: Number(r.blockNumber) }; log("4.1 deployed hot vault", ev.hot);
  }
  // constructor args match what the contract reports
  const rd = (address, abi, functionName, args = []) => pub.readContract({ address, abi, functionName, args });
  const checks = {
    "hot owner account": getAddress(await rd(ev.hot.address, hot.abi, "OWNER_ACCOUNT")) === getAddress(drill.evm),
    "hot owner key hash": (await rd(ev.hot.address, hot.abi, "OWNER_KEY_HASH")) === (await import("viem")).keccak256("0x" + Buffer.from(owner.publicKey).toString("hex")),
    "hot guardian hash": (await rd(ev.hot.address, hot.abi, "GUARDIAN_KEY_HASH")) === guardianHash,
    "hot recipient allowlisted": await rd(ev.hot.address, hot.abi, "allowedRecipient", [funder.evm]),
    "hot drill NOT allowlisted": !(await rd(ev.hot.address, hot.abi, "allowedRecipient", [drill.evm])),
    "cold release time": (await rd(ev.cold.address, cold.abi, "RELEASE_TIME")) === RELEASE_TIME,
    "cold drill NOT allowlisted": !(await rd(ev.cold.address, cold.abi, "allowedRecipient", [drill.evm])),
  };
  log("4.1 constructor args verified", checks);
  if (!Object.values(checks).every(Boolean)) throw new Error("constructor argument check failed");

  // 4.2 live auth check (owner heartbeat, relayed by the funder)
  if (!ev.heartbeat) {
    const deadline = (await chainNow()) + 3600;
    const s = await signRequest({ vault: ev.hot.address, abi: hot.abi, kp: owner, action: ACTION.HEARTBEAT, role: ROLE.OWNER, deadline });
    const hash = await w.writeContract({ address: ev.hot.address, abi: hot.abi, functionName: "heartbeat", args: [BigInt(deadline), s.pk, s.sig] });
    const r = await pub.waitForTransactionReceipt({ hash });
    const n = await rd(ev.hot.address, hot.abi, "nonces", [1]);
    ev.heartbeat = { tx: hash, status: r.status, ownerNonceAfter: n.toString() }; log("4.2 live signed heartbeat", ev.heartbeat);
    if (r.status !== "success" || n !== 1n) throw new Error("heartbeat check failed");
  }

  // 4.3 fund
  const bal = (a) => pub.getBalance({ address: a });
  if (!ev.funded) {
    for (const [name, v, qor] of [["cold", ev.cold.address, COLD_QOR], ["hot", ev.hot.address, HOT_QOR]]) {
      const hash = await w.sendTransaction({ to: v, value: parseEther(qor) });
      const r = await pub.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error(`funding ${name} failed`);
      log(`4.3 funded ${name} vault`, { qor, tx: hash });
    }
    ev.funded = { coldWei: (await bal(ev.cold.address)).toString(), hotWei: (await bal(ev.hot.address)).toString() }; save();
  }
  // fest tokens: whatever the funder holds gets split 85/15
  ev.tokens = ev.tokens ?? {};
  for (const [name, t] of Object.entries(FEST)) {
    const have = await pub.readContract({ address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [funder.evm] });
    if (have === 0n || ev.tokens[name]) continue;
    const toCold = (have * 85n) / 100n, toHot = have - toCold;
    for (const [v, vabi, amt] of [[ev.cold.address, cold.abi, toCold], [ev.hot.address, hot.abi, toHot]]) {
      let h = await w.writeContract({ address: t.address, abi: erc20Abi, functionName: "approve", args: [v, amt] });
      await pub.waitForTransactionReceipt({ hash: h });
      h = await w.writeContract({ address: v, abi: vabi, functionName: "depositToken", args: [t.address, amt] });
      const r = await pub.waitForTransactionReceipt({ hash: h });
      if (r.status !== "success") throw new Error(`token deposit ${name} failed`);
      log(`4.3 deposited ${name}`, { vault: v, amount: amt.toString(), tx: h });
    }
    ev.tokens[name] = true; save();
  }

  // 4.4 live withdrawal test: 1 QOR from the hot vault to the funder
  if (!ev.withdrawal) {
    const amt = parseEther("1"), deadline = (await chainNow()) + 3600;
    const f = [addrWord(ZERO), addrWord(funder.evm), uintWord(amt)];
    const s = await signRequest({ vault: ev.hot.address, abi: hot.abi, kp: owner, action: ACTION.WITHDRAW, role: ROLE.OWNER, deadline, f });
    const before = await bal(ev.hot.address);
    const hash = await w.writeContract({ address: ev.hot.address, abi: hot.abi, functionName: "withdraw", args: [ZERO, funder.evm, amt, BigInt(deadline), s.pk, s.sig] });
    const r = await pub.waitForTransactionReceipt({ hash });
    const after = await bal(ev.hot.address);
    const spent = await rd(ev.hot.address, hot.abi, "spentInWindow", [ZERO]);
    ev.withdrawal = { tx: hash, status: r.status, hotBefore: before.toString(), hotAfter: after.toString(), spentInWindow: spent.toString() };
    log("4.4 live owner-signed withdrawal", ev.withdrawal);
    if (r.status !== "success" || before - after !== amt || spent !== amt) throw new Error("withdrawal check failed");
    // replaying the same signature must now fail (eth_call)
    let replayBlocked = false;
    try { await pub.simulateContract({ account: funder.evm, address: ev.hot.address, abi: hot.abi, functionName: "withdraw", args: [ZERO, funder.evm, amt, BigInt(deadline), s.pk, s.sig] }); } catch { replayBlocked = true; }
    log("4.4 replay of the same signature reverts", { replayBlocked }); if (!replayBlocked) throw new Error("replay not blocked");
  }

  // live proof the cold vault is locked: a correctly shaped release must revert
  let coldLocked = false;
  try {
    const kp = owner; const deadline = (await chainNow()) + 3600;
    const s = await signRequest({ vault: ev.cold.address, abi: cold.abi, kp, domain: (await import("./lib/messages.mjs")).COLD_DOMAIN, action: ACTION.COLD_RELEASE, role: ROLE.OWNER, deadline, f: [addrWord(ZERO), addrWord(funder.evm), uintWord(1n)], crossCheck: false });
    await pub.simulateContract({ account: funder.evm, address: ev.cold.address, abi: cold.abi, functionName: "release", args: [ZERO, funder.evm, 1n, BigInt(deadline), s.pk, s.sig] });
  } catch (e) { coldLocked = /Locked/.test(String(e.message) + String(e.cause?.message ?? "") + String(e.cause?.data?.errorName ?? "")); }
  log("4.4 cold vault release is refused while locked", { coldLocked }); if (!coldLocked) throw new Error("cold vault not provably locked");
} finally {
  // 4.5 close windows, always
  if (opened) {
    const cl = await closeWindow(funder);
    log("4.5 closed funder window", { hash: cl.hash, code: cl.deliverCode ?? cl.checkCode, windowFoundAfter: cl.windowFoundAfter });
  }
}

const final = {
  "funder window closed": (await c.windowRecord(funder.address)).found === false,
  "drill window absent": (await c.windowRecord(drill.address)).found === false,
  "drill balance empty": (await c.allBalances(drill.address)).length === 0,
  "hot vault holds QOR": (await pub.getBalance({ address: ev.hot.address })) > 0n,
  "cold vault holds QOR": (await pub.getBalance({ address: ev.cold.address })) > 0n,
};
ev.final = { at: new Date().toISOString(), checks: final, hotWei: (await pub.getBalance({ address: ev.hot.address })).toString(), coldWei: (await pub.getBalance({ address: ev.cold.address })).toString(), funderUqor: (await c.balance(funder.address)).toString() };
save(); console.log(final);
if (!Object.values(final).every(Boolean)) { console.error("PHASE 4 CHECK FAILED"); process.exit(1); }
console.log("PHASE 4 PASS", ev.hot.address, ev.cold.address);
