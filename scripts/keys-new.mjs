// Creates throwaway testnet accounts. Secrets go to .secrets/<name>.mnemonic (mode 600); only addresses are printed.
import { generateMnemonic, deriveUnifiedAccount } from "@qorechain/sdk";
import fs from "node:fs";
const names = process.argv.slice(2);
if (!names.length) { console.error("usage: node scripts/keys-new.mjs <name>..."); process.exit(1); }
fs.mkdirSync(".secrets", { recursive: true, mode: 0o700 });
for (const name of names) {
  const file = `.secrets/${name}.mnemonic`;
  if (fs.existsSync(file)) { console.error(`${name}: exists, not overwriting`); }
  else fs.writeFileSync(file, generateMnemonic(256) + "\n", { mode: 0o600, flag: "wx" });
  const acct = await deriveUnifiedAccount(fs.readFileSync(file, "utf8").trim());
  const pick = (o, re) => Object.entries(o).find(([k, v]) => typeof v === "string" && re.test(k) )?.[1];
  console.log(JSON.stringify({ name, native: pick(acct, /cosmos|native|bech|qor/i), evm: pick(acct, /evm|eth|0x|hex/i) }));
}
