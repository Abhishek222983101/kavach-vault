// Pre-signs the transactions a KEYLESS cloud runner (GitHub Actions) can broadcast for us, so the laptop need not stay on.
//   * K heartbeats: native cross-VM calls into the hot vault, signed by the drill account (hybrid), carrying owner-signed
//     heartbeat requests for consecutive vault nonces, with consecutive account sequences. Broadcast in order, they prove life.
//   * 1 freeze: a native cross-VM call signed by a dedicated "freezer" account, carrying a guardian-signed freeze request.
// The blobs contain signatures, not keys. They are valid only while the drill account's sequence, the freezer's sequence and
// the vault's nonces stay as they are now, so do not send any other transaction from the drill account or the freezer afterwards.
//   node scripts/presign-cloud.mjs                      real vault, outer signer "drill"
//   node scripts/presign-cloud.mjs --tag test --hot 0x.. --outer spike-c --cold-none      (used by the test)
import fs from "node:fs";
import { encodeFunctionData } from "viem";
import * as c from "./lib/chain.mjs";
import { pub } from "./lib/evm.mjs";
import { signMsgs } from "./lib/native.mjs";
import { evidence, hotArt } from "./lib/ops.mjs";
import { signRequest, guardianKeypair, ACTION, ROLE } from "./lib/vault.mjs";

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const TAG = opt("--tag", "real"), K = Number(opt("--count", "3"));
const ev = evidence("phase4.json"), HOT = opt("--hot", ev.hot.address), COLD = argv.includes("--cold-none") ? null : ev.cold.address;
const DEADLINE = Math.floor(Date.parse("2026-11-20T23:59:00Z") / 1000);
const outer = await c.loadAccount(opt("--outer", "drill")), funder = await c.loadAccount("funder"), freezer = await c.loadAccount("freezer");
const owner = (await c.loadAccount("drill")).pqc, abi = hotArt().abi;
const GAS = 1500000, FEE = Math.ceil(GAS * 0.11) + 1000;
const dir = `.secrets/cloud/${TAG}`; fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

const info = async (a) => (await c.getJson(`/cosmos/auth/v1beta1/accounts/${a}`)).body.account;
const seqOf = async (a) => BigInt((await info(a)).sequence ?? (await info(a)).base_account?.sequence ?? 0);
const outerSeq = await seqOf(outer.address), freezerSeq = await seqOf(freezer.address);
const ownerNonce = await pub.readContract({ address: HOT, abi, functionName: "nonces", args: [1] });
const guardianNonce = await pub.readContract({ address: HOT, abi, functionName: "nonces", args: [2] });
const call = (from, data) => c.msg.crossvm.crossVmCall({ sender: from.address, sourceVm: "cosmwasm", targetVm: "evm", targetContract: HOT, payload: c.fromHex(data) });

const simulate = async (raw) => { const r = await fetch(c.REST + "/cosmos/tx/v1beta1/simulate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tx_bytes: Buffer.from(raw).toString("base64") }) }); const j = await r.json(); return { ok: r.ok && !!j.gas_info, gasUsed: j.gas_info?.gas_used, error: r.ok ? undefined : (j.message ?? JSON.stringify(j)).slice(0, 160) }; };

const blobs = { heartbeats: [], simulate: [] };
for (let k = 0; k < K; k++) {
  const s = await signRequest({ vault: HOT, abi, kp: owner, action: ACTION.HEARTBEAT, role: ROLE.OWNER, deadline: DEADLINE, nonceOverride: ownerNonce + BigInt(k) });
  const data = encodeFunctionData({ abi, functionName: "heartbeat", args: [BigInt(DEADLINE), s.pk, s.sig] });
  const { txRawBytes } = await signMsgs(outer, [call(outer, data)], { gas: GAS, feeUqor: FEE, mode: "hybrid", granter: funder.address, sequence: outerSeq + BigInt(k) });
  fs.writeFileSync(`${dir}/hb-${k}.b64`, Buffer.from(txRawBytes).toString("base64"), { mode: 0o600 });
  blobs.heartbeats.push(txRawBytes.length);
  if (k === 0) blobs.simulate.push({ what: "heartbeat 0", ...(await simulate(txRawBytes)) });
}
{
  const s = await signRequest({ vault: HOT, abi, kp: guardianKeypair(), action: ACTION.FREEZE, role: ROLE.GUARDIAN, deadline: DEADLINE, nonceOverride: guardianNonce });
  const data = encodeFunctionData({ abi, functionName: "freeze", args: [Number(ROLE.GUARDIAN), BigInt(DEADLINE), s.pk, s.sig] });
  const { txRawBytes } = await signMsgs(freezer, [call(freezer, data)], { gas: GAS, feeUqor: FEE, mode: "hybrid", sequence: freezerSeq });
  fs.writeFileSync(`${dir}/freeze.b64`, Buffer.from(txRawBytes).toString("base64"), { mode: 0o600 });
  blobs.freezeBytes = txRawBytes.length; blobs.simulate.push({ what: "freeze", ...(await simulate(txRawBytes)) });
}
const rec = await c.pqcRecord(outer.address);
const config = {
  tag: TAG, createdAt: new Date().toISOString(), chainId: c.CHAIN_ID, rest: c.REST, evmRpc: process.env.QORE_EVM_RPC ?? "https://evm-testnet.qore.host", tmRpc: "https://rpc-testnet.qore.host",
  hot: HOT, cold: COLD, outer: { address: outer.address, evm: outer.evm }, funder: funder.address, freezer: freezer.address,
  heartbeatCount: K, deadline: DEADLINE,
  baseline: { hotWei: (await pub.getBalance({ address: HOT })).toString(), coldWei: COLD ? (await pub.getBalance({ address: COLD })).toString() : null,
    spent: (await pub.readContract({ address: HOT, abi, functionName: "spentInWindow", args: ["0x0000000000000000000000000000000000000000"] })).toString(),
    outerSeq: outerSeq.toString(), freezerSeq: freezerSeq.toString(), ownerNonce: ownerNonce.toString(), guardianNonce: guardianNonce.toString(),
    pqKey: JSON.stringify(rec.account?.public_key ?? rec.account?.pubkey ?? "").length + ":" + (rec.account?.possession_proven ?? "") },
};
fs.writeFileSync(`${dir}/config.json`, JSON.stringify(config, null, 2));
console.log(JSON.stringify({ tag: TAG, hot: HOT, heartbeats: K, bytesPerHeartbeat: blobs.heartbeats, freezeBytes: blobs.freezeBytes, simulate: blobs.simulate, baseline: config.baseline }, null, 1));
