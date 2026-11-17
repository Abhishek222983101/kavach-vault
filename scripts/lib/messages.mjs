// TypeScript twin of src/libs/KavachMessage.sol: the 416-byte request that the owner/guardian PQ key signs.
import { encodeAbiParameters, keccak256, toHex, hexToBytes } from "viem";

export const HOT_DOMAIN = "0xff4b41564143482d5641554c542d763100000000000000000000000000000000";
export const COLD_DOMAIN = "0xff4b41564143482d434f4c442d76310000000000000000000000000000000000";
export const ACTION = { WITHDRAW: 1n, QUEUE_WITHDRAW: 2n, QUEUE_LIMITS: 3n, QUEUE_RECIPIENT: 4n, QUEUE_DELAY: 5n, CANCEL: 8n, FREEZE: 9n, UNFREEZE: 10n, HEARTBEAT: 11n, COLD_RELEASE: 21n };
export const ROLE = { OWNER: 1n, GUARDIAN: 2n };
export const KEY_VERSION = 1n;
const z = "0x" + "00".repeat(32);

/** @param p {{domain?: string, chainId?: bigint, vault: string, action: bigint, role: bigint, nonce: bigint, deadline: bigint, f?: string[]}} */
export function buildMessage(p) {
  const f = [...(p.f ?? [])]; while (f.length < 5) f.push(z);
  const hex = encodeAbiParameters(
    [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
     { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }],
    [p.domain ?? HOT_DOMAIN, p.chainId ?? 9800n, p.vault, p.action, p.role, p.keyVersion ?? KEY_VERSION, p.nonce, p.deadline, ...f]);
  if ((hex.length - 2) / 2 !== 416) throw new Error("message must be 416 bytes");
  return hexToBytes(hex);
}
export const addrWord = (a) => "0x" + a.replace(/^0x/, "").toLowerCase().padStart(64, "0");
export const uintWord = (n) => "0x" + BigInt(n).toString(16).padStart(64, "0");
export { keccak256, toHex };

// CLI used by Foundry's ffi cross-check: node scripts/lib/messages.mjs <vault> <action> <role> <nonce> <deadline> <f0> <f1> <f2> <f3> <f4>
if (import.meta.url === `file://${process.argv[1]}`) {
  const [vault, action, role, nonce, deadline, ...f] = process.argv.slice(2);
  process.stdout.write(toHex(buildMessage({ vault, action: BigInt(action), role: BigInt(role), nonce: BigInt(nonce), deadline: BigInt(deadline), f })));
}
