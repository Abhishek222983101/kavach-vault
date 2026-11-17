// Vault helpers: artifacts, ABI calls, owner/guardian PQ signing. Secrets are read from .secrets/ and never printed.
import fs from "node:fs";
import { generatePqcKeypair, pqcSign } from "@qorechain/sdk";
import { toHex, hexToBytes } from "viem";
import { buildMessage, ACTION, ROLE, HOT_DOMAIN, COLD_DOMAIN, addrWord, uintWord } from "./messages.mjs";
import { pub } from "./evm.mjs";

export const art = (name) => JSON.parse(fs.readFileSync(`out/${name}.sol/${name}.json`, "utf8"));
export const FEST = {
  fUSD: { address: "0x97143B771D34ddb9130b807b135Ae675A5a963CA", decimals: 6 },
  fETH: { address: "0x02292293c13880a26242690eb70a0e42B8E91c28", decimals: 18 },
  fBTC: { address: "0x4604e7E45b2ecdbfbDc157103f5B2b62cb16451A", decimals: 8 },
};
export const ZERO = "0x0000000000000000000000000000000000000000";
export const erc20Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
];

export function guardianKeypair() {
  const g = JSON.parse(fs.readFileSync(".secrets/guardian.json", "utf8"));
  const kp = generatePqcKeypair(Uint8Array.from(Buffer.from(g.seedHex, "hex")));
  if (Buffer.from(kp.publicKey).toString("hex") !== g.publicKeyHex) throw new Error("guardian seed does not match stored public key");
  return kp;
}

export const chainNow = async () => Number((await pub.getBlock()).timestamp);

/** Sign a request with a PQ keypair; also asserts that the contract's own view returns the exact bytes we build locally. */
export async function signRequest({ vault, abi, kp, domain = HOT_DOMAIN, action, role, deadline, f = [], crossCheck = true }) {
  const nonce = await pub.readContract({ address: vault, abi, functionName: "nonces", args: [Number(role)] })
    .catch(() => pub.readContract({ address: vault, abi, functionName: "nonce" }).catch(() => null)); // hot: nonces(role); cold: nonce()
  const local = buildMessage({ domain, vault, action, role, nonce: BigInt(nonce ?? 0), deadline: BigInt(deadline), f });
  if (crossCheck && nonce !== null && abi.some((x) => x.name === "messageFor")) {
    const f5 = [...f]; while (f5.length < 5) f5.push("0x" + "00".repeat(32));
    const onchain = await pub.readContract({ address: vault, abi, functionName: "messageFor", args: [action, Number(role), BigInt(deadline), f5] });
    if (onchain.toLowerCase() !== toHex(local).toLowerCase()) throw new Error("local message differs from the contract's messageFor");
  }
  const sig = pqcSign(kp.secretKey, local);
  return { pk: toHex(kp.publicKey), sig: toHex(sig), message: local, nonce };
}
export { ACTION, ROLE, HOT_DOMAIN, COLD_DOMAIN, addrWord, uintWord, hexToBytes, toHex };
