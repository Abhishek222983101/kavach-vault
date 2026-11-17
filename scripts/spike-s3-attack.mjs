import fs from "node:fs";
import { encodeFunctionData } from "viem";
import * as c from "./lib/chain.mjs";
import { sendMsgs } from "./lib/native.mjs";
const { address: ping } = JSON.parse(fs.readFileSync("evidence/spike-s3-ping.json", "utf8"));
const abi = JSON.parse(fs.readFileSync("out/SpikePing.sol/SpikePing.json", "utf8")).abi;
const f = await c.loadAccount("funder"), s = await c.loadAccount("spike-c");
const m = c.msg.crossvm.crossVmCall({ sender: s.address, sourceVm: "cosmwasm", targetVm: "evm", targetContract: ping, payload: c.fromHex(encodeFunctionData({ abi, functionName: "ping" })) });
for (const [name, opts] of [["classical cross-VM call via grant", { mode: "classical", granter: f.address }], ["classical cross-VM call, own balance (0)", { mode: "classical" }]]) {
  const r = await sendMsgs(s, [m], { gas: 600000, feeUqor: 70000, ...opts });
  console.log(JSON.stringify({ attack: name, checkCode: r.checkCode, codespace: r.codespace, log: r.log.slice(0, 110) }));
}
