// Proves the cold vault's live release path with a short-lived canary vault (4 min lock), before the real one matters.
import fs from "node:fs";
import { parseEther, getAddress } from "viem";
import * as c from "./lib/chain.mjs";
import { openWindow, closeWindow, wallet, pub } from "./lib/evm.mjs";
import { art, ZERO, signRequest, chainNow, ACTION, ROLE, COLD_DOMAIN, addrWord, uintWord } from "./lib/vault.mjs";
const funder = await c.loadAccount("funder"), drill = await c.loadAccount("drill"), relayer = await c.loadAccount("relayer");
const cold = art("KavachColdVault"); const wf = wallet(funder), wr = wallet(relayer);
const pk = "0x" + Buffer.from(drill.pqc.publicKey).toString("hex");
const out = { at: new Date().toISOString() };
const release = (addr, amt, s, deadline) => ({ address: addr, abi: cold.abi, functionName: "release", args: [ZERO, funder.evm, amt, BigInt(deadline), s.pk, s.sig] });
const sign = (addr, amt, deadline) => signRequest({ vault: addr, abi: cold.abi, kp: drill.pqc, domain: COLD_DOMAIN, action: ACTION.COLD_RELEASE, role: ROLE.OWNER, deadline, f: [addrWord(ZERO), addrWord(funder.evm), uintWord(amt)], crossCheck: false });
let opened = false;
if (process.env.CANARY) { out.canary = { address: process.env.CANARY, releaseTime: String(process.env.RELEASE_TIME ?? 0) }; }
else try {
  const o = await openWindow(funder, { blocks: 300n, maxTxs: 4n, maxValueUqor: 10_000_000n }); opened = true;
  const releaseTime = BigInt((await chainNow()) + 240);
  const h = await wf.deployContract({ abi: cold.abi, bytecode: cold.bytecode.object, args: [pk, drill.evm, [getAddress(funder.evm)], [], releaseTime] });
  const r = await pub.waitForTransactionReceipt({ hash: h }); out.canary = { address: r.contractAddress, tx: h, releaseTime: releaseTime.toString() };
  const f = await wf.sendTransaction({ to: r.contractAddress, value: parseEther("2") }); await pub.waitForTransactionReceipt({ hash: f });
  console.log("canary deployed", out.canary.address);
} finally { if (opened) { const cl = await closeWindow(funder); out.windowClosed = cl.windowFoundAfter === false; console.log("window closed:", out.windowClosed); } }

const addr = out.canary.address, amt = parseEther("1");
// 1) before the lock ends: refused (relayer is a classical-only account, like the attacker)
let d = (await chainNow()) + 3600; let s = await sign(addr, amt, d);
out.refusedWhileLocked = await pub.simulateContract({ account: relayer.evm, ...release(addr, amt, s, d) }).then(() => false, (e) => /Locked/.test(String(e.message)));
console.log("refused while locked:", out.refusedWhileLocked);
// 2) wait for the lock to end on chain time
while (out.canary.releaseTime !== "0" && (await chainNow()) <= Number(out.canary.releaseTime) + 2) await new Promise((r) => setTimeout(r, 10000));
// 3) wrong key (attacker's own valid ML-DSA signature) must fail even after unlock
const { generatePqcKeypair } = await import("@qorechain/sdk");
d = (await chainNow()) + 3600; const att = generatePqcKeypair();
const sa = await signRequest({ vault: addr, abi: cold.abi, kp: att, domain: COLD_DOMAIN, action: ACTION.COLD_RELEASE, role: ROLE.OWNER, deadline: d, f: [addrWord(ZERO), addrWord(funder.evm), uintWord(amt)], crossCheck: false });
out.attackerKeyRefusedAfterUnlock = await pub.simulateContract({ account: relayer.evm, ...release(addr, amt, sa, d) }).then(() => false, () => true);
// 4) the real owner signature releases funds
s = await sign(addr, amt, d);
const before = await pub.getBalance({ address: addr });
await openWindow(funder, { blocks: 200n, maxTxs: 2n, maxValueUqor: 5_000_000n });
let hash, rc;
try { hash = await wf.writeContract(release(addr, amt, s, d)); rc = await pub.waitForTransactionReceipt({ hash }); }
finally { const cl = await closeWindow(funder); out.windowClosed = cl.windowFoundAfter === false; }
const after = await pub.getBalance({ address: addr });
out.release = { tx: hash, status: rc.status, vaultBefore: before.toString(), vaultAfter: after.toString() };
out.replayRefused = await pub.simulateContract({ account: relayer.evm, ...release(addr, amt, s, d) }).then(() => false, () => true);
out.windowsClosed = (await c.windowRecord(funder.address)).found === false && (await c.windowRecord(drill.address)).found === false;
console.log(out);
fs.writeFileSync("evidence/phase4b-cold-canary.json", JSON.stringify(out, null, 2));
const ok = out.refusedWhileLocked && out.attackerKeyRefusedAfterUnlock && out.replayRefused && out.windowsClosed && rc.status === "success" && before - after === amt;
console.log(ok ? "COLD CANARY PASS" : "COLD CANARY FAIL"); process.exit(ok ? 0 : 1);
