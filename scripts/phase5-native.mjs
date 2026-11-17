// Phase 5.1: the bot's native-lane attacks, from the drill account's CLASSICAL key only.
//  C1: one classical-only tx per message type in the SDK registry (+ hand-built valid versions of the dangerous ones)
//  C2: the same sweep with fee_granter = funder (tries to burn our fee grant)
// Pass criteria: no tx accepted; drill balance 0 and sequence unchanged; funder balance and grant unchanged.
import fs from "node:fs";
import { encodeFunctionData } from "viem";
import { qorechainRegistry, generatePqcKeypair, signProofOfPossession, buildRegisterPqcKeyMsg, openEvmWindowMsg } from "@qorechain/sdk";
import * as c from "./lib/chain.mjs";
import { sendMsgs, authInfo } from "./lib/native.mjs";

const drill = await c.loadAccount("drill"), funder = await c.loadAccount("funder"), relayer = await c.loadAccount("relayer");
const ev = JSON.parse(fs.readFileSync("evidence/phase4.json", "utf8"));
const reg = qorechainRegistry();
const evil = generatePqcKeypair();
const ATT = relayer.address; // an address the bot might want to pay
const ADDR_FIELDS = /^(sender|creator|signer|from|fromAddress|delegatorAddress|granter|owner|admin|proposer|voter|depositor|authority|account|address|delegator|submitter|requester|node|operator|issuer|licensee|user)$/;
const RECV_FIELDS = /^(receiver|recipient|toAddress|grantee|newOwner|to|delegate|destination)$/;

async function snapshot() {
  const allow = await c.getJson(`/cosmos/feegrant/v1beta1/allowance/${funder.address}/${drill.address}`);
  return { drillBal: await c.allBalances(drill.address), drillSeq: (await authInfo(drill.address)).sequence.toString(),
           funderUqor: (await c.balance(funder.address)).toString(), grant: JSON.stringify(allow.body.allowance ?? allow.body),
           drillWindow: (await c.windowRecord(drill.address)).found, drillPq: JSON.stringify((await c.pqcRecord(drill.address)).account?.public_key ?? "").length,
           hotWei: ev.hot.address, };
}
const before = await snapshot();

// ---- build the message list -------------------------------------------------------------------
const msgs = [];
const types = [...reg.types.keys()].filter((u) => /\.Msg[A-Z]\w*$/.test(u) && !/Response$/.test(u)).sort();
const hot = ev.hot.address, cold = ev.cold.address;
const vaultCall = (target, sig) => c.msg.crossvm.crossVmCall({ sender: drill.address, sourceVm: "cosmwasm", targetVm: "evm", targetContract: target, payload: c.fromHex(sig) });
const heartbeatJunk = encodeFunctionData({ abi: [{ type: "function", name: "heartbeat", inputs: [{ type: "uint256" }, { type: "bytes" }, { type: "bytes" }], outputs: [] }], functionName: "heartbeat", args: [9999999999n, "0x", "0x"] });
const withdrawJunk = encodeFunctionData({ abi: [{ type: "function", name: "withdraw", inputs: [{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" }, { type: "bytes" }], outputs: [] }], functionName: "withdraw", args: ["0x0000000000000000000000000000000000000000", "0x7Eff75F315Ac227995fc07e1e9Cb1C85E0e14627", 1n, 9999999999n, "0x", "0x"] });
const pop = signProofOfPossession({ chainId: c.CHAIN_ID, account: drill.address, keypair: evil });
const handBuilt = [
  ["H1 bank send 1 uqor to attacker address", { typeUrl: "/cosmos.bank.v1beta1.MsgSend", value: { fromAddress: drill.address, toAddress: ATT, amount: [{ denom: "uqor", amount: "1" }] } }],
  ["H2 bank send, whole fee-grant-sized amount", { typeUrl: "/cosmos.bank.v1beta1.MsgSend", value: { fromAddress: drill.address, toAddress: ATT, amount: [{ denom: "uqor", amount: "2000000" }] } }],
  ["H3 open EVM window (unscoped)", openEvmWindowMsg({ sender: drill.address, blocks: 100n, maxTxs: 5n, maxValue: 1000000n })],
  ["H4 open EVM window targeting our vault", openEvmWindowMsg({ sender: drill.address, blocks: 100n, maxTxs: 5n, maxValue: 1000000n, allowedTargets: [hot, cold] })],
  ["H5 register attacker's PQ key (classical-only)", buildRegisterPqcKeyMsg(drill.address, { pqcKeypair: evil, proofOfPossession: pop })],
  ["H6 cross-VM call into hot vault heartbeat (junk)", vaultCall(hot, heartbeatJunk)],
  ["H7 cross-VM call into hot vault withdraw (junk)", vaultCall(hot, withdrawJunk)],
  ["H8 cross-VM call into cold vault withdraw-shaped payload", vaultCall(cold, withdrawJunk)],
  ["H9 authz grant everything to attacker", { typeUrl: "/cosmos.authz.v1beta1.MsgGrant", value: { granter: drill.address, grantee: ATT, grant: { authorization: { typeUrl: "/cosmos.authz.v1beta1.GenericAuthorization", value: new Uint8Array([10, 28, ...Buffer.from("/cosmos.bank.v1beta1.MsgSend")]) } } } }],
  ["H10 feegrant from drill to attacker", { typeUrl: "/cosmos.feegrant.v1beta1.MsgGrantAllowance", value: { granter: drill.address, grantee: ATT } }],
  ["H11 delegate to a validator", { typeUrl: "/cosmos.staking.v1beta1.MsgDelegate", value: { delegatorAddress: drill.address, validatorAddress: drill.address, amount: { denom: "uqor", amount: "1" } } }],
  ["H12 IBC transfer", { typeUrl: "/ibc.applications.transfer.v1.MsgTransfer", value: { sourcePort: "transfer", sourceChannel: "channel-0", token: { denom: "uqor", amount: "1" }, sender: drill.address, receiver: "cosmos1abc", timeoutTimestamp: BigInt(Date.now() + 600000) * 1000000n } }],
  ["H13 authorize EVM delegation (EIP-7702 style)", { typeUrl: "/qorechain.pqc.v1.MsgAuthorizeEVMDelegation", value: { sender: drill.address, delegate: relayer.evm, blocks: 1000n } }],
  ["H14 close EVM window", { typeUrl: "/qorechain.pqc.v1.MsgCloseEVMWindow", value: { sender: drill.address } }],
];
for (const [name, m] of handBuilt) msgs.push({ name, m });
const SIGNER_LIKE = /address|relayer|challenger|sequencer|resolver|holder|authority|owner|operator|sender|creator|signer|delegator|grantee|granter|voter|depositor|proposer|admin|submitter|requester/i;
for (const u of types) {
  const T = reg.types.get(u); const base = T.fromPartial({}); const v = {};
  for (const [k, d] of Object.entries(base)) {
    if (typeof d === "string") {
      if (/validator/i.test(k) && !/relayer|sequencer/i.test(k)) continue;
      if (ADDR_FIELDS.test(k) || SIGNER_LIKE.test(k)) v[k] = drill.address;
      else if (RECV_FIELDS.test(k)) v[k] = ATT;
      else if (/(^id$|Id$|chain|port|channel|client|connection|name|feature|layer|rollup|type|denom|memo|payload|weights)/i.test(k)) v[k] = /denom/i.test(k) ? "uqor" : /(weights|payload)/i.test(k) ? "{}" : "x";
      else if (/amount|limit|value|stake/i.test(k)) v[k] = "1";
    } else if (typeof d === "bigint" && !/version|height|timeout|revision/i.test(k)) v[k] = 1n;
    else if (typeof d === "number" && /algorithm|type|status|option/i.test(k)) v[k] = 1;
  }
  msgs.push({ name: `G ${u}`, m: { typeUrl: u, value: T.fromPartial(v) } });
}

// ---- run both sweeps ----------------------------------------------------------------------------
const rows = [];
for (const [sweep, granter] of [["C1 plain", undefined], ["C2 fee-granted", funder.address]]) {
  for (const { name, m } of msgs) {
    let r;
    try { r = await sendMsgs(drill, [m], { mode: "classical", gas: 300000, feeUqor: 31000, granter, wait: false }); }
    catch (e) {
      r = { threw: String(e.message ?? e).slice(0, 160) };
      if (/BigInt/.test(r.threw)) { // an id-like field is a 64-bit integer: retry with 1 instead of "x"
        const fixed = JSON.parse(JSON.stringify(m, (k, v) => (typeof v === "bigint" ? { __b: v.toString() } : v === "x" ? "1" : v)), (k, v) => (v && v.__b ? BigInt(v.__b) : v));
        try { r = await sendMsgs(drill, [{ typeUrl: m.typeUrl, value: reg.types.get(m.typeUrl).fromPartial(fixed.value) }], { mode: "classical", gas: 300000, feeUqor: 31000, granter, wait: false }); }
        catch (e2) { r = { threw: String(e2.message ?? e2).slice(0, 160) }; }
      }
    }
    const accepted = r.checkCode === 0;
    const cls = r.threw ? "NOT_SENT" : accepted ? "ACCEPTED" : (r.codespace === "pqc" ? "REFUSED_PQ" : "REFUSED_OTHER");
    rows.push({ sweep, name, cls, checkCode: r.checkCode, codespace: r.codespace, log: (r.log ?? r.threw ?? "").slice(0, 140), hash: r.hash });
    if (cls === "ACCEPTED") console.error("!!! ACCEPTED:", sweep, name, r.hash);
  }
  console.log(sweep, "done");
}
await new Promise((s) => setTimeout(s, 8000));
const after = await snapshot();
const count = (f) => rows.filter(f).length;
const summary = {
  at: new Date().toISOString(), messageTypes: types.length, handBuilt: handBuilt.length, attempts: rows.length,
  accepted: count((r) => r.cls === "ACCEPTED"), refusedByPqCheck: count((r) => r.cls === "REFUSED_PQ"),
  refusedEarlier: count((r) => r.cls === "REFUSED_OTHER"), notSent: count((r) => r.cls === "NOT_SENT"),
  unchanged: { drillBalances: JSON.stringify(before.drillBal) === JSON.stringify(after.drillBal) && after.drillBal.length === 0, drillSequence: before.drillSeq === after.drillSeq,
    funderBalance: before.funderUqor === after.funderUqor, feeGrant: before.grant === after.grant, drillWindow: after.drillWindow === false, drillPqKey: before.drillPq === after.drillPq },
};
fs.writeFileSync("evidence/attack-native.json", JSON.stringify({ summary, before, after, rows }, null, 2));
console.log(JSON.stringify(summary, null, 1));
const bad = rows.filter((r) => r.cls === "REFUSED_OTHER" && r.name.startsWith("H"));
if (bad.length) console.log("hand-built attacks refused by something other than the PQ check:", bad.map((b) => `${b.name} [${b.checkCode}/${b.codespace}] ${b.log.slice(0, 80)}`));
const ok = summary.accepted === 0 && Object.values(summary.unchanged).every(Boolean);
console.log(ok ? "NATIVE SWEEP PASS" : "NATIVE SWEEP FAIL"); process.exit(ok ? 0 : 1);
