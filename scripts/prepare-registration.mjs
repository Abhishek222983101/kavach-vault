// Phase 7.5 helper (the registration itself is done by a person on the project page).
// Runs the preflight, then writes the drill account's CLASSICAL private key to a mode-600 file so it can be copied into the form
// without ever appearing in a chat or a terminal scrollback. It never prints the key.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { getAddress } from "viem";
import * as c from "./lib/chain.mjs";
import { evidence } from "./lib/ops.mjs";

const pf = spawnSync("node", ["scripts/preflight.mjs", "--snapshot"], { stdio: "inherit" });
if (pf.status !== 0) { console.error("\nPreflight failed: do not register until every FAIL is fixed."); process.exit(1); }
const ev = evidence("phase4.json"), drill = await c.loadAccount("drill");
const file = ".secrets/REGISTRATION-drill-ecdsa-key.txt";
const hex = drill.classicalKeyHex.replace(/^0x/, "");
fs.writeFileSync(file, `${hex}\n`, { mode: 0o600 }); fs.chmodSync(file, 0o600);
console.log(`
==================== WHAT TO PASTE ON THE PROJECT PAGE ====================
Page:                         https://build.qorechain.io/p/kavach-vault  (Q-Day Drill registration)
Drill account (for reference): ${drill.address}
                               ${drill.evm}
ECDSA private key (hex):       open ${file} and copy the single line
                               (64 hex characters; if the form insists on a 0x prefix, add "0x" in front)
Contract addresses to attack:  ${getAddress(ev.hot.address)}
                               ${getAddress(ev.cold.address)}
===========================================================================
Never paste the MNEMONIC (the .mnemonic files), only the one line from the file above.
The key goes to the attacker bot and is published after the drill. The account holds nothing, so that is fine.
After you have registered, delete the file:  shred -u ${file}
`);
