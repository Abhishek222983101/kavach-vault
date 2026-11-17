import * as c from "./lib/chain.mjs";
import { registerKey } from "./lib/native.mjs";
for (const n of process.argv.slice(2)) {
  const a = await c.loadAccount(n);
  const before = await c.balance(a.address);
  try {
    const r = await registerKey(a);
    const rec = await c.pqcRecord(a.address);
    console.log(JSON.stringify({ name: n, ...r, found: rec.found, key_type: rec.account?.key_type,
      possession_proven: rec.account?.possession_proven, feePaid: c.fmt(before - (await c.balance(a.address))) }));
  } catch (e) { console.log(JSON.stringify({ name: n, error: String(e.message ?? e).slice(0, 400) })); }
}
