// S3: can a zero-balance account call an EVM contract from the NATIVE lane (no window), fee paid by the scoped grant?
import fs from "node:fs";
import { encodeFunctionData } from "viem";
import * as c from "./lib/chain.mjs";
import { sendMsgs } from "./lib/native.mjs";
import { pub } from "./lib/evm.mjs";
const { address: ping } = JSON.parse(fs.readFileSync("evidence/spike-s3-ping.json", "utf8"));
const abi = JSON.parse(fs.readFileSync("out/SpikePing.sol/SpikePing.json", "utf8")).abi;
const f = await c.loadAccount("funder"), s = await c.loadAccount("spike-c");
const payload = c.fromHex(encodeFunctionData({ abi, functionName: "ping" }));
const m = c.msg.crossvm.crossVmCall({ sender: s.address, sourceVm: "cosmwasm", targetVm: "evm", targetContract: ping, payload });
const spend = async () => (await c.getJson(`/cosmos/feegrant/v1beta1/allowance/${f.address}/${s.address}`)).body.allowance?.allowance?.allowance?.spend_limit?.[0]?.amount;
const before = { count: await pub.readContract({ address: ping, abi, functionName: "count" }), spend: await spend(), bal: String(await c.balance(s.address)) };
const r = await sendMsgs(s, [m], { gas: 600000, feeUqor: 70000, mode: "hybrid", granter: f.address });
const after = { count: await pub.readContract({ address: ping, abi, functionName: "count" }), lastCaller: await pub.readContract({ address: ping, abi, functionName: "lastCaller" }), spend: await spend(), bal: String(await c.balance(s.address)), window: (await c.windowRecord(s.address)).found };
const out = { tx: r.hash, code: r.deliverCode ?? r.checkCode, log: r.log.slice(0, 200), before: { ...before, count: String(before.count) }, after: { ...after, count: String(after.count) }, expectCaller: s.evm, callerMatches: after.lastCaller?.toLowerCase() === s.evm.toLowerCase() };
console.log(JSON.stringify(out, null, 1));
fs.writeFileSync("evidence/spike-s3.json", JSON.stringify({ at: new Date().toISOString(), ...out }, null, 2));
