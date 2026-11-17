// Shared helpers. Secrets are read from .secrets/ only and never printed.
import fs from "node:fs";
import {
  createClient, deriveUnifiedAccount, directSignerFromPrivateKey, ensurePqcRegistered,
  signProofOfPossession, msg,
} from "@qorechain/sdk";

export const REST = process.env.QORE_REST ?? "https://api-testnet.qore.host";
export const CHAIN_ID = "qorechain-diana";
export const client = createClient({ network: "testnet" });

export const fromHex = (h) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ""), "hex"));

export async function loadAccount(name) {
  const mnemonic = fs.readFileSync(`.secrets/${name}.mnemonic`, "utf8").trim();
  const acct = await deriveUnifiedAccount(mnemonic);
  const signer = await directSignerFromPrivateKey(fromHex(acct.privateKey), "qor");
  return { name, acct, signer, address: acct.cosmos, evm: acct.evm, pqc: acct.pqc, classicalKeyHex: acct.privateKey };
}

export async function getJson(path) {
  const r = await fetch(REST + path);
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
export async function balance(addr, denom = "uqor") {
  const { body } = await getJson(`/cosmos/bank/v1beta1/balances/${addr}`);
  const b = (body.balances ?? []).find((x) => x.denom === denom);
  return BigInt(b?.amount ?? "0");
}
export async function allBalances(addr) {
  const { body } = await getJson(`/cosmos/bank/v1beta1/balances/${addr}`);
  return body.balances ?? [];
}
export const pqcRecord = async (addr) => (await getJson(`/qorechain/pqc/v1/account/${addr}`)).body;
export const windowRecord = async (addr) => (await getJson(`/qorechain/pqc/v1/evm_window/${addr}`)).body;

/** Hybrid-signing tx client (the account's PQ key must already be registered, except for the registration itself). */
export async function connect(a) {
  return client.connectTx(a.signer, { pqcKeypair: a.pqc });
}

/** Register the account's PQ key with a proof of possession. Safe to call twice. */
export async function register(a) {
  const tx = await connect(a);
  const proofOfPossession = signProofOfPossession({ chainId: CHAIN_ID, account: a.address, keypair: a.pqc });
  const res = await ensurePqcRegistered(tx, { pqcKeypair: a.pqc, proofOfPossession, rest: REST });
  return res;
}

export async function send(from, toAddr, uqor, memo = "") {
  const tx = await connect(from);
  const r = await tx.bankSend(toAddr, [{ denom: "uqor", amount: String(uqor) }], { fee: "auto", memo });
  return r;
}
export const qor = (n) => BigInt(Math.round(n * 1_000_000));
export const fmt = (u) => (Number(u) / 1e6).toFixed(6) + " QOR";
export { msg };
