// S4: what exactly does the pqcVerify precompile (0x...0a01) verify? Read-only eth_call, no funds needed.
import { createPublicClient, http, toHex } from "viem";
import { generatePqcKeypair, pqcSign } from "@qorechain/sdk";
const RPC = process.env.QORE_EVM_RPC ?? "https://evm-testnet.qore.host";
const abi = [{ type: "function", name: "pqcVerify", stateMutability: "view",
  inputs: [{ name: "pubkey", type: "bytes" }, { name: "signature", type: "bytes" }, { name: "message", type: "bytes" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "pqcKeyStatus", stateMutability: "view", inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "bool" }, { type: "uint8" }, { type: "bytes" }, { type: "bool" }] }];
const client = createPublicClient({ transport: http(RPC) });
const A = "0x0000000000000000000000000000000000000a01", S = "0x0000000000000000000000000000000000000a02";
const v = async (pk, sig, m) => { try { return await client.readContract({ address: A, abi, functionName: "pqcVerify", args: [toHex(pk), toHex(sig), toHex(m)] }); } catch (e) { return "REVERT:" + String(e.shortMessage ?? e.message).slice(0, 90); } };
const rows = [];
const t = (name, got, want) => { const ok = got === want; rows.push({ name, got, want, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}: got ${got}, expected ${want}`); };
const a = generatePqcKeypair(), b = generatePqcKeypair();
const msg = Uint8Array.from({ length: 416 }, (_, i) => (i * 7 + 1) & 0xff); msg[0] = 0xff;
const sig = pqcSign(a.secretKey, msg);
t("valid 416-byte 0xFF-prefixed message", await v(a.publicKey, sig, msg), true);
t("hedged signature accepted", await v(a.publicKey, pqcSign(a.secretKey, msg, { hedged: true }), msg), true);
const m2 = msg.slice(); m2[200] ^= 1; t("one message bit flipped", await v(a.publicKey, sig, m2), false);
const m3 = msg.slice(0, 415); t("message truncated by 1 byte", await v(a.publicKey, sig, m3), false);
const m4 = Uint8Array.from([...msg, 0]); t("message extended by 1 byte", await v(a.publicKey, sig, m4), false);
t("signature by another key", await v(b.publicKey, sig, msg), false);
const s2 = sig.slice(); s2[10] ^= 1; t("signature byte flipped", await v(a.publicKey, s2, msg), false);
const s3 = sig.slice(); s3[s3.length - 1] ^= 1; t("last signature byte flipped", await v(a.publicKey, s3, msg), false);
t("signature truncated", await v(a.publicKey, sig.slice(0, 4626), msg), false);
t("signature with trailing byte", await v(a.publicKey, Uint8Array.from([...sig, 0]), msg), false);
t("all-zero signature", await v(a.publicKey, new Uint8Array(4627), msg), false);
t("all-zero public key", await v(new Uint8Array(2592), sig, msg), false);
t("empty public key", await v(new Uint8Array(0), sig, msg), false);
t("empty signature", await v(a.publicKey, new Uint8Array(0), msg), false);
t("empty message with a signature of it", await v(a.publicKey, pqcSign(a.secretKey, new Uint8Array(0)), new Uint8Array(0)), true);
// context-string signatures must NOT verify as plain
try { const ctxSig = pqcSign(a.secretKey, msg, { context: new Uint8Array([1, 2, 3]) }); t("signature made with a non-empty context", await v(a.publicKey, ctxSig, msg), false); } catch (e) { console.log("(context option unsupported by SDK:", String(e.message).slice(0, 60) + ")"); }
// key status for an unregistered account and a registered one
const st = await client.readContract({ address: S, abi, functionName: "pqcKeyStatus", args: ["0x000000000000000000000000000000000000dEaD"] });
t("pqcKeyStatus(unregistered) = (false,0,0x,false)", JSON.stringify([st[0], Number(st[1]), st[2], st[3]]), JSON.stringify([false, 0, "0x", false]));
import("node:fs").then(fs => fs.writeFileSync("evidence/spike-s4.json", JSON.stringify({ at: new Date().toISOString(), rpc: RPC, rows }, null, 2)));
console.log(rows.every(r => r.ok) ? "\nS4 PASS" : "\nS4 HAS FAILURES");
