// Deploys a throwaway hot vault (same constructor shape as the real one, small limits) for tests. Never used in the drill.
import fs from "node:fs";
import { parseEther, getAddress, keccak256 } from "viem";
import * as c from "./lib/chain.mjs";
import { openWindow, closeWindow, wallet, pub } from "./lib/evm.mjs";
import { art, FEST, guardianKeypair } from "./lib/vault.mjs";
const tag = process.argv[2] ?? "t2", file = `evidence/test-vault-${tag}.json`;
if (fs.existsSync(file)) { console.log(fs.readFileSync(file, "utf8")); process.exit(0); }
const funder = await c.loadAccount("funder"), drill = await c.loadAccount("drill"), hot = art("KavachVault"), gk = guardianKeypair();
let opened = false, T;
try {
  await openWindow(funder, { blocks: 300n, maxTxs: 4n, maxValueUqor: 30_000_000n }); opened = true; const w = wallet(funder);
  const lim = [{ perTx: parseEther("2"), daily: parseEther("4") }, { perTx: 10n ** 6n, daily: 10n ** 7n }, { perTx: 10n ** 15n, daily: 10n ** 16n }, { perTx: 10n ** 4n, daily: 10n ** 5n }];
  const h = await w.deployContract({ abi: hot.abi, bytecode: hot.bytecode.object, args: ["0x" + Buffer.from(drill.pqc.publicKey).toString("hex"), drill.evm, keccak256("0x" + Buffer.from(gk.publicKey).toString("hex")), [getAddress(funder.evm)], Object.values(FEST).map((t) => t.address), lim, 3600n] });
  const r = await pub.waitForTransactionReceipt({ hash: h });
  const f = await w.sendTransaction({ to: r.contractAddress, value: parseEther("5") }); await pub.waitForTransactionReceipt({ hash: f });
  T = { address: r.contractAddress, deployTx: h, fundTx: f };
} finally { if (opened) await closeWindow(funder); }
fs.writeFileSync(file, JSON.stringify(T, null, 2)); console.log(JSON.stringify(T));
