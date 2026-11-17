// S5 + S1: what does a classical-only attacker cost a registered account? Runs on spike-a only.
import fs from "node:fs";
import { generatePqcKeypair, signProofOfPossession, buildRegisterPqcKeyMsg, openEvmWindowMsg } from "@qorechain/sdk";
import * as c from "./lib/chain.mjs";
import { sendMsgs, authInfo, bankSend } from "./lib/native.mjs";

const a = await c.loadAccount("spike-a"), b = await c.loadAccount("spike-b");
const evil = generatePqcKeypair();
const rows = [];
async function attack(name, fn) {
  const bal0 = await c.balance(a.address), seq0 = (await authInfo(a.address)).sequence;
  let r; try { r = await fn(); } catch (e) { r = { threw: String(e.message ?? e).slice(0, 200) }; }
  await new Promise((s) => setTimeout(s, 3000));
  const bal1 = await c.balance(a.address), seq1 = (await authInfo(a.address)).sequence;
  const row = { name, checkCode: r.checkCode, deliverCode: r.deliverCode, codespace: r.codespace, log: (r.log ?? r.threw ?? "").slice(0, 160),
    balanceDeltaUqor: String(bal1 - bal0), sequenceDelta: String(seq1 - seq0), hash: r.hash };
  rows.push(row); console.log(JSON.stringify(row));
}
const bankMsg = [{ typeUrl: "/cosmos.bank.v1beta1.MsgSend", value: { fromAddress: a.address, toAddress: b.address, amount: [{ denom: "uqor", amount: "1000000" }] } }];

await attack("A1 bank send, classical-only", () => sendMsgs(a, bankMsg, { mode: "classical" }));
await attack("A2 open EVM window, classical-only", () => sendMsgs(a, [openEvmWindowMsg({ sender: a.address, blocks: 100n, maxTxs: 5n, maxValue: 1000000n })], { mode: "classical" }));
const pop = signProofOfPossession({ chainId: c.CHAIN_ID, account: a.address, keypair: evil });
const reg = buildRegisterPqcKeyMsg(a.address, { pqcKeypair: evil, proofOfPossession: pop });
await attack("B1/S1 re-register attacker PQ key, classical-only (account already has a key)", () => sendMsgs(a, [reg], { gas: 600000, feeUqor: 70000, mode: "classical" }));
const evilAcct = { ...a, acct: { ...a.acct, pqc: evil } };
await attack("B3 bank send, hybrid with attacker's made-up PQ key", () => sendMsgs(evilAcct, bankMsg, { mode: "hybrid" }));
await attack("B3b open EVM window, hybrid with attacker's made-up PQ key", () => sendMsgs(evilAcct, [openEvmWindowMsg({ sender: a.address, blocks: 100n, maxTxs: 5n, maxValue: 1000000n })], { mode: "hybrid" }));
// Control: the real hybrid send must still work afterwards and cost only its fee.
await attack("CONTROL bank send, genuine hybrid", () => sendMsgs(a, bankMsg, { mode: "hybrid" }));

fs.writeFileSync("evidence/spike-s1s5.json", JSON.stringify({ at: new Date().toISOString(), account: a.address, rows }, null, 2));
const w = await c.windowRecord(a.address); console.log("window state for spike-a:", JSON.stringify({ found: w.found, live: w.live }));
console.log("PQ record:", JSON.stringify({ key_type: (await c.pqcRecord(a.address)).account?.key_type, pop: (await c.pqcRecord(a.address)).account?.possession_proven }));
