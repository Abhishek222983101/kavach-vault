import * as c from "./lib/chain.mjs";
import { bankSend } from "./lib/native.mjs";
const [from, to, amt] = process.argv.slice(2);
const a = await c.loadAccount(from), b = await c.loadAccount(to);
const r = await bankSend(a, b.address, c.qor(Number(amt)));
console.log(JSON.stringify({ from, to, amt, hash: r.hash, deliverCode: r.deliverCode, log: r.log }), "to balance", c.fmt(await c.balance(b.address)));
