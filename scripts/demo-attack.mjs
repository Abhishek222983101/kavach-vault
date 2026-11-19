// Live demo, run after the drill: plays the Q-Day attacker with the drill account's leaked CLASSICAL key and tries the
// attacks the drill rules name, against the real drill account and the real vaults. Read-only for the vaults (eth_call);
// the native and EVM attempts are broadcast for real and must be refused. The "attacker's address" is one of our own
// test accounts, so nothing could be lost even in the impossible case that an attempt landed.
//   node scripts/demo-attack.mjs
import { encodeFunctionData, parseEther } from "viem";
import { openEvmWindowMsg } from "@qorechain/sdk";
import * as c from "./lib/chain.mjs";
import { pub, wallet } from "./lib/evm.mjs";
import { sendMsgs } from "./lib/native.mjs";
import { evidence, hotArt, coldArt } from "./lib/ops.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = async (s = "", ms = 900) => { console.log(s); await sleep(ms); };
const drill = await c.loadAccount("drill"), thief = await c.loadAccount("relayer");
const ev = evidence("phase4.json"), HOT = ev.hot.address, COLD = ev.cold.address;
const qor = (u) => (Number(u) / 1e6).toFixed(6) + " QOR", eth = (w) => (Number(w) / 1e18).toFixed(2) + " QOR";
const state = async () => ({ drill: await c.balance(drill.address), win: (await c.windowRecord(drill.address)).found,
  hot: await pub.getBalance({ address: HOT }), cold: await pub.getBalance({ address: COLD }) });
const refusal = (r) => (r.checkCode !== 0 ? `REFUSED (code ${r.checkCode}): ${r.log.replace(/\s+/g, " ").slice(0, 170)}` : r.deliverCode === 0 ? "ACCEPTED" : `FAILED on chain (code ${r.deliverCode})`);

await say("Kavach Vault live demo: the attacker holds the drill account's classical (secp256k1) key.", 1200);
await say(`  drill account   ${drill.address}`, 300);
await say(`                  ${drill.evm}`, 300);
await say(`  attacker wants  ${thief.address}`, 900);
const s0 = await state();
await say(`\nBefore: drill ${qor(s0.drill)}, EVM window ${s0.win ? "OPEN" : "none"}, hot vault ${eth(s0.hot)}, cold vault ${eth(s0.cold)}`, 1500);

await say("\n[1] Native transfer of the whole balance, signed with the classical key only");
const r1 = await sendMsgs(drill, [{ typeUrl: "/cosmos.bank.v1beta1.MsgSend", value: { fromAddress: drill.address, toAddress: thief.address, amount: [{ denom: "uqor", amount: "1000000" }] } }], { mode: "classical", gas: 200000, feeUqor: 25000, wait: false });
await say("    " + refusal(r1), 1500);

await say("\n[2] Open an EVM window, so the classical key could send EVM transactions");
const r2 = await sendMsgs(drill, [openEvmWindowMsg({ sender: drill.address, blocks: 1000n, maxTxs: 50n, maxValue: 1000000n })], { mode: "classical", gas: 300000, feeUqor: 35000, wait: false });
await say("    " + refusal(r2), 1500);

await say("\n[3] EVM transfer from the drill account's 0x address");
try {
  const h = await wallet(drill).sendTransaction({ to: thief.evm, value: parseEther("0.5"), gas: 21000n, gasPrice: await pub.getGasPrice() });
  await say("    SENT " + h + " (checking...)"); const rc = await pub.waitForTransactionReceipt({ hash: h, timeout: 30000 }).catch(() => null); await say("    receipt: " + (rc?.status ?? "none"));
} catch (e) { await say("    REFUSED by the EVM lane: " + String(e.details ?? e.shortMessage ?? e.message).replace(/\s+/g, " ").replace(/^failed to broadcast transaction: /, "").slice(0, 170), 1500); }

const abi = hotArt().abi;
const fakePk = "0x" + Buffer.alloc(2592, 7).toString("hex"), fakeSig = "0x" + Buffer.alloc(4627, 9).toString("hex");
const ownerPk = "0x" + Buffer.from(drill.pqc.publicKey).toString("hex");
const funder = await c.loadAccount("funder");
const drain = async (label, address, a, fn, to, pk, amount = parseEther("1")) => {
  try { await pub.simulateContract({ account: drill.evm, address, abi: a, functionName: fn, args: ["0x0000000000000000000000000000000000000000", to, amount, 9999999999n, pk, fakeSig] }); await say(`    ${label}: WOULD SUCCEED`); }
  catch (e) { await say(`    ${label}: reverts with ${(e.cause?.data?.errorName ?? e.shortMessage ?? e.message).toString().replace(/\s+/g, " ").slice(0, 80)}`, 1200); }
};
await say("\n[4] Drain calls on the vaults as the drill account (simulated: with no window they cannot even be sent)");
await drain("hot vault  -> attacker's address                   ", HOT, abi, "withdraw", thief.evm, ownerPk);
await drain("hot vault  -> allowlisted address, attacker's PQ key", HOT, abi, "withdraw", funder.evm, fakePk);
await drain("hot vault  -> allowlisted address, forged signature ", HOT, abi, "withdraw", funder.evm, ownerPk);
await drain("cold vault -> allowlisted address, forged signature ", COLD, coldArt().abi, "release", funder.evm, ownerPk, parseEther("100"));

const s1 = await state();
await say(`\nAfter:  drill ${qor(s1.drill)}, EVM window ${s1.win ? "OPEN" : "none"}, hot vault ${eth(s1.hot)}, cold vault ${eth(s1.cold)}`, 600);
const same = s1.drill === s0.drill && s1.win === s0.win && s1.hot === s0.hot && s1.cold === s0.cold;
await say(same ? "Nothing moved. The leaked classical key cannot spend anything." : "STATE CHANGED: investigate", 1500);
