// Phase 2: drill + guardian keys, drill registration through a temporary grant, then the scoped grant. The drill account never holds QOR.
import fs from "node:fs";
import crypto from "node:crypto";
import { generatePqcKeypair } from "@qorechain/sdk";
import * as c from "./lib/chain.mjs";
import { sendMsgs } from "./lib/native.mjs";
import { grantMsg, revokeMsg } from "./lib/grant.mjs";
import { signProofOfPossession, buildRegisterPqcKeyMsg } from "@qorechain/sdk";

const SEND = "/cosmos.bank.v1beta1.MsgSend", XVM = "/qorechain.crossvm.v1.MsgCrossVMCall", REG = "/qorechain.pqc.v1.MsgRegisterPQCKeyV2";
const funder = await c.loadAccount("funder");
if (!fs.existsSync(".secrets/drill.mnemonic")) { await import("node:child_process").then(cp => cp.execSync("node scripts/keys-new.mjs drill", { stdio: "inherit" })); }
const drill = await c.loadAccount("drill");
// Guardian: a separate ML-DSA-87 key from its own random seed. Not an account; only its public key matters on chain.
if (!fs.existsSync(".secrets/guardian.json")) {
  const seed = crypto.randomBytes(32); const kp = generatePqcKeypair(seed);
  fs.writeFileSync(".secrets/guardian.json", JSON.stringify({ seedHex: seed.toString("hex"), publicKeyHex: Buffer.from(kp.publicKey).toString("hex") }), { mode: 0o600 });
}
console.log("drill:", drill.address, drill.evm);
console.log("guardian public key bytes:", JSON.parse(fs.readFileSync(".secrets/guardian.json")).publicKeyHex.length / 2);

const expiry = new Date("2026-11-20T23:59:00Z");
const out = [];
const rec0 = await c.pqcRecord(drill.address);
if (!rec0.found) {
  let r = await sendMsgs(funder, [grantMsg({ granter: funder.address, grantee: drill.address, spendLimitUqor: 2_000_000, expiry, allowedMessages: [REG] })]);
  out.push({ step: "2.5a temporary grant (registration only)", code: r.deliverCode ?? r.checkCode, hash: r.hash });
  const pop = signProofOfPossession({ chainId: c.CHAIN_ID, account: drill.address, keypair: drill.pqc });
  r = await sendMsgs(drill, [buildRegisterPqcKeyMsg(drill.address, { pqcKeypair: drill.pqc, proofOfPossession: pop })], { gas: 600000, feeUqor: 70000, mode: "classical", granter: funder.address });
  out.push({ step: "2.3 register drill key via grant", code: r.deliverCode ?? r.checkCode, log: r.log, hash: r.hash });
}
// Replace with the scoped grant: only MsgSend and MsgCrossVMCall
let r = await sendMsgs(funder, [revokeMsg(funder.address, drill.address), grantMsg({ granter: funder.address, grantee: drill.address, spendLimitUqor: 2_000_000, expiry, allowedMessages: [SEND, XVM] })]);
out.push({ step: "2.5 scoped grant (send, cross-VM only)", code: r.deliverCode ?? r.checkCode, hash: r.hash });
for (const o of out) console.log(JSON.stringify(o));

// Acceptance checks
const rec = await c.pqcRecord(drill.address);
const g = await c.getJson(`/cosmos/feegrant/v1beta1/allowance/${funder.address}/${drill.address}`);
const types = g.body.allowance?.allowance?.allowed_messages;
const checks = {
  "drill key registered, hybrid, proof of possession": rec.found && rec.account?.key_type === "hybrid" && rec.account?.possession_proven === true,
  "drill balances empty": (await c.allBalances(drill.address)).length === 0,
  "drill has no EVM window": (await c.windowRecord(drill.address)).found === false,
  "grant allows exactly send + cross-VM": Array.isArray(types) && types.length === 2 && types.includes(SEND) && types.includes(XVM),
  "grant spend limit 2 QOR": g.body.allowance?.allowance?.allowance?.spend_limit?.[0]?.amount === "2000000",
};
console.log(checks);
fs.writeFileSync("evidence/phase2.json", JSON.stringify({ at: new Date().toISOString(), drill: { native: drill.address, evm: drill.evm }, steps: out, checks }, null, 2));
if (!Object.values(checks).every(Boolean)) { console.error("PHASE 2 CHECK FAILED"); process.exit(1); }
console.log("PHASE 2 PASS");
