// Phase 5.2: raw EVM transactions signed with the CLASSICAL key, from (a) the real drill account and
// (b) spike-b, a funded, PQ-registered stand-in for "the bot funds the drill account first".
import fs from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { encodeFunctionData, parseGwei, toHex } from "viem";
import * as c from "./lib/chain.mjs";
import { pub } from "./lib/evm.mjs";
import { FEST, erc20Abi } from "./lib/vault.mjs";

const ev = JSON.parse(fs.readFileSync("evidence/phase4.json", "utf8"));
const ATT = "0x2E95335BaFC4999c6C8F83A28564da0E06380868";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const MAX = 2n ** 256n - 1n;
const iface = (sig) => [{ type: "function", name: sig.n, inputs: sig.i.map((t) => ({ type: t })), outputs: [] }];
const call = (n, i, args) => encodeFunctionData({ abi: iface({ n, i }), functionName: n, args });
const payloads = [
  ["transfer 1 wei to attacker (legacy)", { type: "legacy", to: ATT, value: 1n }],
  ["transfer 1 wei (eip1559)", { type: "eip1559", to: ATT, value: 1n }],
  ["transfer 1 wei (eip2930)", { type: "eip2930", to: ATT, value: 1n, accessList: [] }],
  ["contract creation", { type: "eip1559", data: "0x600a600c600039600a6000f3602a60005260206000f3" }],
  ...Object.entries(FEST).flatMap(([n, t]) => [
    [`${n}.approve(attacker, max)`, { type: "eip1559", to: t.address, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ATT, MAX] }) }],
    [`${n}.transfer(attacker, 1)`, { type: "eip1559", to: t.address, data: call("transfer", ["address", "uint256"], [ATT, 1n]) }],
  ]),
  ["Permit2.approve shaped call", { type: "eip1559", to: PERMIT2, data: call("approve", ["address", "address", "uint160", "uint48"], [FEST.fUSD.address, ATT, 2n ** 160n - 1n, 2 ** 40]) }],
  ["hot.withdraw junk", { type: "eip1559", to: ev.hot.address, data: call("withdraw", ["address", "address", "uint256", "uint256", "bytes", "bytes"], ["0x0000000000000000000000000000000000000000", ATT, 1n, 9999999999n, "0x", "0x"]) }],
  ["hot.heartbeat junk", { type: "eip1559", to: ev.hot.address, data: call("heartbeat", ["uint256", "bytes", "bytes"], [9999999999n, "0x", "0x"]) }],
  ["hot.freeze junk", { type: "eip1559", to: ev.hot.address, data: call("freeze", ["uint8", "uint256", "bytes", "bytes"], [1, 9999999999n, "0x", "0x"]) }],
  ["cold.release junk", { type: "eip1559", to: ev.cold.address, data: call("release", ["address", "address", "uint256", "uint256", "bytes", "bytes"], ["0x0000000000000000000000000000000000000000", ATT, 1n, 9999999999n, "0x", "0x"]) }],
  ["send QOR into hot vault (deposit path)", { type: "eip1559", to: ev.hot.address, value: 1n }],
  ["EIP-7702 delegation to attacker contract", { type: "eip7702", to: ATT, value: 0n, auth: true }],
];

async function sweep(name, a) {
  const acct = privateKeyToAccount("0x" + a.classicalKeyHex.replace(/^0x/, ""));
  const snap = async () => ({ wei: (await pub.getBalance({ address: a.evm })).toString(), nonce: await pub.getTransactionCount({ address: a.evm }), code: await pub.getCode({ address: a.evm }) ?? "0x", uqor: (await c.balance(a.address)).toString(), window: (await c.windowRecord(a.address)).found });
  const before = await snap(); const rows = [];
  for (const [label, p] of payloads) {
    const nonce = await pub.getTransactionCount({ address: a.evm, blockTag: "pending" });
    const base = { chainId: 9800, nonce, gas: 400000n, to: p.to, value: p.value ?? 0n, data: p.data };
    let raw, err;
    try {
      if (p.type === "legacy") raw = await acct.signTransaction({ ...base, type: "legacy", gasPrice: parseGwei("100") });
      else if (p.type === "eip2930") raw = await acct.signTransaction({ ...base, type: "eip2930", gasPrice: parseGwei("100"), accessList: [] });
      else if (p.type === "eip7702") {
        const authorization = await acct.signAuthorization({ contractAddress: ATT, chainId: 9800, nonce: nonce + 1 });
        raw = await acct.signTransaction({ ...base, type: "eip7702", maxFeePerGas: parseGwei("100"), maxPriorityFeePerGas: parseGwei("1"), authorizationList: [authorization] });
      } else raw = await acct.signTransaction({ ...base, type: "eip1559", maxFeePerGas: parseGwei("100"), maxPriorityFeePerGas: parseGwei("1") });
    } catch (e) { rows.push({ label, cls: "NOT_SENT", msg: String(e.shortMessage ?? e.message).slice(0, 140) }); continue; }
    let hash = null;
    try { hash = await pub.request({ method: "eth_sendRawTransaction", params: [raw] }); } catch (e) { err = String(e.details ?? e.shortMessage ?? e.message); }
    if (hash) { rows.push({ label, cls: "ACCEPTED", hash }); console.error("!!! ACCEPTED", name, label, hash); continue; }
    const cls = /window|post-quantum|PQ/i.test(err) ? "REFUSED_NO_WINDOW" : /insufficient|balance|funds/i.test(err) ? "REFUSED_FUNDS" : "REFUSED_OTHER";
    rows.push({ label, cls, msg: err.slice(0, 180) });
  }
  await new Promise((s) => setTimeout(s, 6000));
  const after = await snap();
  return { name, address: a.evm, before, after, unchanged: JSON.stringify(before) === JSON.stringify(after), rows };
}
const results = [await sweep("drill (real account, zero balance)", await c.loadAccount("drill")), await sweep("spike-b (funded stand-in)", await c.loadAccount("spike-b"))];
const all = results.flatMap((r) => r.rows);
const summary = { at: new Date().toISOString(), attempts: all.length, accepted: all.filter((r) => r.cls === "ACCEPTED").length,
  refusedNoWindow: all.filter((r) => r.cls === "REFUSED_NO_WINDOW").length, refusedFunds: all.filter((r) => r.cls === "REFUSED_FUNDS").length,
  refusedOther: all.filter((r) => r.cls === "REFUSED_OTHER").length, notSent: all.filter((r) => r.cls === "NOT_SENT").length, accountsUnchanged: results.map((r) => r.unchanged) };
fs.writeFileSync("evidence/attack-evm.json", JSON.stringify({ summary, results }, null, 2));
console.log(JSON.stringify(summary));
for (const r of all.filter((x) => x.cls !== "REFUSED_NO_WINDOW")) console.log(r.cls, r.label, (r.msg ?? "").slice(0, 120));
const ok = summary.accepted === 0 && summary.accountsUnchanged.every(Boolean);
console.log(ok ? "EVM SWEEP PASS" : "EVM SWEEP FAIL"); process.exit(ok ? 0 : 1);
