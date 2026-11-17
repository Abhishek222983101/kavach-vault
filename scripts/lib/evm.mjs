// EVM lane helpers: windows are opened/closed on the native lane (hybrid), EVM txs are sent with viem.
import { createPublicClient, createWalletClient, http, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { openEvmWindowMsg, closeEvmWindowMsg } from "@qorechain/sdk";
import { sendMsgs } from "./native.mjs";
import { windowRecord } from "./chain.mjs";

export const EVM_RPC = process.env.QORE_EVM_RPC ?? "https://evm-testnet.qore.host";
export const diana = defineChain({ id: 9800, name: "qorechain-diana", nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 }, rpcUrls: { default: { http: [EVM_RPC] } } });
export const pub = createPublicClient({ chain: diana, transport: http(EVM_RPC) });
export const wallet = (a) => createWalletClient({ chain: diana, transport: http(EVM_RPC), account: privateKeyToAccount("0x" + a.classicalKeyHex.replace(/^0x/, "")) });

/** Open a window (hybrid native tx). scope: { allowedTargets?: string[], nativeOnly?: boolean } */
export async function openWindow(a, { blocks = 300n, maxTxs = 5n, maxValueUqor = 10_000_000n, allowedTargets, nativeOnly } = {}) {
  const m = openEvmWindowMsg({ sender: a.address, blocks, maxTxs, maxValue: maxValueUqor, ...(allowedTargets ? { allowedTargets } : {}), ...(nativeOnly ? { nativeOnly } : {}) });
  return sendMsgs(a, [m]);
}
export async function closeWindow(a) {
  const r = await sendMsgs(a, [closeEvmWindowMsg(a.address)]);
  const w = await windowRecord(a.address);
  return { ...r, windowFoundAfter: w.found };
}
