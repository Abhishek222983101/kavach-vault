// S2: can a never-funded account register its key and send hybrid txs with fees paid ONLY by a scoped fee grant?
// And can a classical-only attacker use that grant? Runs on spike-c (throwaway).
import fs from "node:fs";
import { signProofOfPossession, buildRegisterPqcKeyMsg, generatePqcKeypair, openEvmWindowMsg } from "@qorechain/sdk";
import * as c from "./lib/chain.mjs";
import { sendMsgs, bankSend } from "./lib/native.mjs";
import { grantMsg, revokeMsg } from "./lib/grant.mjs";

const funder = await c.loadAccount("funder"), s = await c.loadAccount("spike-c");
const SEND = "/cosmos.bank.v1beta1.MsgSend", XVM = "/qorechain.crossvm.v1.MsgCrossVMCall", REG = "/qorechain.pqc.v1.MsgRegisterPQCKeyV2";
const grantState = async () => { const g = await c.getJson(`/cosmos/feegrant/v1beta1/allowance/${funder.address}/${s.address}`); return g.status === 200 ? JSON.stringify(g.body.allowance?.allowance) : `none(${g.status})`; };
const spendLeft = async () => { const g = await c.getJson(`/cosmos/feegrant/v1beta1/allowance/${funder.address}/${s.address}`); const al = g.body.allowance?.allowance; return al?.allowance?.spend_limit?.[0]?.amount ?? al?.spend_limit?.[0]?.amount ?? "none"; };
const rows = []; const log = (o) => { rows.push(o); console.log(JSON.stringify(o)); };
const expiry = new Date(Date.now() + 4 * 3600 * 1000);

// 1. grant incl. registration (bootstrap only)
let r = await sendMsgs(funder, [grantMsg({ granter: funder.address, grantee: s.address, spendLimitUqor: 2_000_000, expiry, allowedMessages: [REG, SEND, XVM] })]);
log({ step: "1 grant (incl. registration)", code: r.deliverCode ?? r.checkCode, log: r.log, hash: r.hash, spendLeft: await spendLeft() });
// 2. register key, classical (bootstrap-exempt), fee from grant; spike-c never holds QOR
const pop = signProofOfPossession({ chainId: c.CHAIN_ID, account: s.address, keypair: s.pqc });
r = await sendMsgs(s, [buildRegisterPqcKeyMsg(s.address, { pqcKeypair: s.pqc, proofOfPossession: pop })], { gas: 600000, feeUqor: 70000, mode: "classical", granter: funder.address });
const rec = await c.pqcRecord(s.address);
log({ step: "2 register via grant", code: r.deliverCode ?? r.checkCode, log: r.log, hash: r.hash, found: rec.found, pop: rec.account?.possession_proven, balance: String(await c.balance(s.address)), spendLeft: await spendLeft() });
// 3. re-grant WITHOUT registration (revoke + grant)
r = await sendMsgs(funder, [revokeMsg(funder.address, s.address), grantMsg({ granter: funder.address, grantee: s.address, spendLimitUqor: 2_000_000, expiry, allowedMessages: [SEND, XVM] })]);
log({ step: "3 revoke + scoped re-grant (send, cross-VM only)", code: r.deliverCode ?? r.checkCode, log: r.log, hash: r.hash, spendLeft: await spendLeft() });
// 4. attacker: classical-only send via grant
const toF = [{ typeUrl: SEND, value: { fromAddress: s.address, toAddress: funder.address, amount: [{ denom: "uqor", amount: "1" }] } }];
let before = await spendLeft();
r = await sendMsgs(s, toF, { mode: "classical", granter: funder.address });
log({ step: "4 ATTACK classical-only send via grant", code: r.checkCode, deliver: r.deliverCode, log: r.log.slice(0, 120), spendBefore: before, spendAfter: await spendLeft() });
// 5. attacker: classical-only registration spam via grant
before = await spendLeft();
const evil = generatePqcKeypair();
r = await sendMsgs(s, [buildRegisterPqcKeyMsg(s.address, { pqcKeypair: evil, proofOfPossession: signProofOfPossession({ chainId: c.CHAIN_ID, account: s.address, keypair: evil }) })], { gas: 600000, feeUqor: 70000, mode: "classical", granter: funder.address });
log({ step: "5 ATTACK classical registration via grant", code: r.checkCode, deliver: r.deliverCode, log: r.log.slice(0, 120), spendBefore: before, spendAfter: await spendLeft() });
// 6. attacker: classical-only window open via grant
before = await spendLeft();
r = await sendMsgs(s, [openEvmWindowMsg({ sender: s.address, blocks: 100n, maxTxs: 5n, maxValue: 1000000n })], { mode: "classical", granter: funder.address });
log({ step: "6 ATTACK classical window open via grant", code: r.checkCode, deliver: r.deliverCode, log: r.log.slice(0, 120), spendBefore: before, spendAfter: await spendLeft() });
// 7. owner: hybrid message type NOT in the grant (window open) must be refused by the grant
before = await spendLeft();
r = await sendMsgs(s, [openEvmWindowMsg({ sender: s.address, blocks: 100n, maxTxs: 5n, maxValue: 1000000n })], { mode: "hybrid", granter: funder.address });
log({ step: "7 hybrid window open via grant (type not allowed)", code: r.checkCode, deliver: r.deliverCode, log: r.log.slice(0, 140), spendBefore: before, spendAfter: await spendLeft(), window: (await c.windowRecord(s.address)).found });
// 8. owner: proof-of-life fallback: funder gives 1 uqor, spike-c sends it back hybrid, fee via grant -> ends at 0
await bankSend(funder, s.address, 1);
before = await spendLeft();
r = await sendMsgs(s, toF, { mode: "hybrid", granter: funder.address });
log({ step: "8 genuine hybrid send via grant", code: r.deliverCode ?? r.checkCode, log: r.log.slice(0, 120), hash: r.hash, spendBefore: before, spendAfter: await spendLeft(), balanceAfter: String(await c.balance(s.address)) });
fs.writeFileSync("evidence/spike-s2.json", JSON.stringify({ at: new Date().toISOString(), grantee: s.address, granter: funder.address, rows }, null, 2));
