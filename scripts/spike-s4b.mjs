// S4b: FIPS-204 context strings and empty messages against the live precompile.
import { createPublicClient, http, toHex } from "viem";
import { ml_dsa87 } from "@noble/post-quantum/ml-dsa.js";
import fs from "node:fs";
const abi = [{ type: "function", name: "pqcVerify", stateMutability: "view", inputs: [{ type: "bytes" }, { type: "bytes" }, { type: "bytes" }], outputs: [{ type: "bool" }] }];
const c = createPublicClient({ transport: http("https://evm-testnet.qore.host") });
const v = (pk, sig, m) => c.readContract({ address: "0x0000000000000000000000000000000000000a01", abi, functionName: "pqcVerify", args: [toHex(pk), toHex(sig), toHex(m)] }).catch(e => "REVERT:" + String(e.shortMessage).slice(0, 80));
const kp = ml_dsa87.keygen(); const pk = kp.publicKey, sk = kp.secretKey;
const msg = Uint8Array.from({ length: 416 }, (_, i) => i & 255); msg[0] = 0xff;
const out = {};
out.plain = await v(pk, ml_dsa87.sign(msg, sk), msg);
out.contextSig = await v(pk, ml_dsa87.sign(msg, sk, { context: Uint8Array.from([1, 2, 3]) }), msg);
out.emptyMsg = await v(pk, ml_dsa87.sign(new Uint8Array(0), sk), new Uint8Array(0));
out.localCtxVsEmptyCtx = ml_dsa87.verify(ml_dsa87.sign(msg, sk, { context: Uint8Array.from([1, 2, 3]) }), msg, pk);
console.log(out, "\nwant: plain=true, contextSig=false (strict empty context), localCtxVsEmptyCtx=false");
fs.writeFileSync("evidence/spike-s4b.json", JSON.stringify({ at: new Date().toISOString(), ...out }, null, 2));
