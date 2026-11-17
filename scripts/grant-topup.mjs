// Replace the drill's fee grant with a larger one, still limited to MsgSend and MsgCrossVMCall, expiring after the drill.
import fs from "node:fs";
import * as c from "./lib/chain.mjs";
import { sendMsgs } from "./lib/native.mjs";
import { grantMsg, revokeMsg } from "./lib/grant.mjs";
const SEND = "/cosmos.bank.v1beta1.MsgSend", XVM = "/qorechain.crossvm.v1.MsgCrossVMCall";
const limit = Number(process.argv[2] ?? 8_000_000);
const f = await c.loadAccount("funder"), d = await c.loadAccount("drill");
const r = await sendMsgs(f, [revokeMsg(f.address, d.address), grantMsg({ granter: f.address, grantee: d.address, spendLimitUqor: limit, expiry: new Date("2026-11-20T23:59:00Z"), allowedMessages: [SEND, XVM] })], { gas: 400000, feeUqor: 45000 });
console.log("code", r.deliverCode ?? r.checkCode, r.hash, r.log);
const g = await c.getJson(`/cosmos/feegrant/v1beta1/allowance/${f.address}/${d.address}`);
const a = g.body.allowance?.allowance; const types = a?.allowed_messages;
const ok = (r.deliverCode ?? r.checkCode) === 0 && a?.allowance?.spend_limit?.[0]?.amount === String(limit) && types?.length === 2 && types.includes(SEND) && types.includes(XVM);
console.log({ limit: a?.allowance?.spend_limit?.[0]?.amount, types, ok });
const ev = fs.existsSync("evidence/grant-topup.json") ? JSON.parse(fs.readFileSync("evidence/grant-topup.json", "utf8")) : [];
ev.push({ at: new Date().toISOString(), hash: r.hash, limitUqor: limit, ok }); fs.writeFileSync("evidence/grant-topup.json", JSON.stringify(ev, null, 2));
process.exit(ok ? 0 : 1);
