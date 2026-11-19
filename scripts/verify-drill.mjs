// Reads the drill result straight from the chain: what the drill account sent during the drill day, its balance, its
// window, the proof of life, and both vaults. Read-only.
//   node scripts/verify-drill.mjs
import * as c from "./lib/chain.mjs";
import { pub } from "./lib/evm.mjs";
import { evidence } from "./lib/ops.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = async (s = "", ms = 700) => { console.log(s); await sleep(ms); };
const drill = await c.loadAccount("drill"), ev = evidence("phase4.json");
const S = Date.parse("2026-11-18T00:00:00Z"), E = Date.parse("2026-11-19T00:00:00Z");
const PROOF = "80517F8F25FF933772FF9789BFAFA648D5AD9D92C6DE893561C9B4C4CFB129BF";

await say(`Drill day: 18 Nov 2026, 00:00 to 23:59 UTC. Drill account ${drill.address}`, 1000);
const txs = (await c.getJson(`/cosmos/tx/v1beta1/txs?query=message.sender%3D%27${drill.address}%27&order_by=ORDER_BY_DESC&limit=50`)).body.tx_responses ?? [];
const during = txs.filter((t) => { const x = Date.parse(t.timestamp); return x >= S && x < E; });
await say(`\nTransactions sent by the drill account during the drill: ${during.length}`);
for (const t of during) await say(`  ${t.timestamp}  code ${t.code}  ${t.tx.body.messages.map((m) => m["@type"].split(".").pop()).join(", ")}  ${t.txhash.slice(0, 16)}...`);
const p = (await c.getJson(`/cosmos/tx/v1beta1/txs/${PROOF}`)).body.tx_response;
await say(`\nProof of life ${PROOF.slice(0, 16)}...: code ${p.code}, block ${p.height}, ${p.timestamp}, fee paid by ${p.tx.auth_info.fee.granter ? "our fee grant" : "the account"}`, 1000);
const bal = await c.allBalances(drill.address), win = await c.windowRecord(drill.address), pq = (await c.pqcRecord(drill.address)).account;
await say(`\nDrill account now: ${bal.map((b) => b.amount + " " + b.denom).join(", ")} (started the drill with 1000000 uqor)`);
await say(`EVM window: ${win.found ? "OPEN" : "none, never opened"}`);
await say(`Post-quantum key: ${pq?.key_type ?? "?"}, proof of possession ${pq?.possession_proven ? "yes" : "no"}`);
const hot = await pub.getBalance({ address: ev.hot.address }), cold = await pub.getBalance({ address: ev.cold.address });
await say(`\nHot vault  ${ev.hot.address}: ${(Number(hot) / 1e18).toFixed(2)} QOR`);
await say(`Cold vault ${ev.cold.address}: ${(Number(cold) / 1e18).toFixed(2)} QOR (locked until 20 Nov 2026 00:00 UTC)`, 1000);
const ok = during.length === 1 && during[0].txhash === PROOF && bal.length === 1 && bal[0].amount === "1000000" && !win.found;
await say(ok ? "\nResult: only our proof of life left the account. 1 QOR before, 1 QOR after: 100% kept." : "\nResult: CHECK FAILED", 1500);
