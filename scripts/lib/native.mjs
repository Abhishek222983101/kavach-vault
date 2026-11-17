// Native-lane transactions for eth-native (unified) accounts, built directly with the SDK's EthNativeSigner.
import { EthNativeSigner, buildRegisterPqcKeyMsg, signProofOfPossession, qorechainRegistry } from "@qorechain/sdk";
import { REST, CHAIN_ID, getJson, pqcRecord } from "./chain.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const stdFee = (gas, uqor, granter) => ({ amount: [{ denom: "uqor", amount: String(uqor) }], gas: String(gas), ...(granter ? { granter } : {}) });

export async function authInfo(addr) {
  const { status, body } = await getJson(`/cosmos/auth/v1beta1/accounts/${addr}`);
  if (status !== 200 || !body.account) throw new Error(`account ${addr} not found (${status})`);
  return { accountNumber: BigInt(body.account.account_number ?? body.account.base_account?.account_number ?? 0),
           sequence: BigInt(body.account.sequence ?? body.account.base_account?.sequence ?? 0) };
}

export async function broadcastRaw(txRawBytes, { wait = true } = {}) {
  const r = await fetch(REST + "/cosmos/tx/v1beta1/txs", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ tx_bytes: Buffer.from(txRawBytes).toString("base64"), mode: "BROADCAST_MODE_SYNC" }) });
  const j = await r.json();
  const tr = j.tx_response ?? {};
  const out = { hash: tr.txhash, checkCode: tr.code ?? 0, codespace: tr.codespace, log: (tr.raw_log ?? j.message ?? "").slice(0, 400) };
  if (!wait || out.checkCode !== 0) return out;
  for (let i = 0; i < 40; i++) {
    await sleep(1500);
    const t = await getJson(`/cosmos/tx/v1beta1/txs/${out.hash}`);
    if (t.status === 200 && t.body.tx_response) {
      const x = t.body.tx_response;
      return { ...out, deliverCode: x.code ?? 0, codespace: x.codespace, log: (x.raw_log ?? "").slice(0, 400), height: x.height, gasUsed: x.gas_used };
    }
  }
  return { ...out, deliverCode: null, log: "not found after waiting" };
}

/** Build + sign (hybrid by default) + broadcast. Returns the broadcast outcome; never throws on chain refusal. */
export async function sendMsgs(a, messages, { gas = 400000, feeUqor, mode = "hybrid", granter, memo = "", wait = true, sequence } = {}) {
  const signer = new EthNativeSigner(a.acct, { signMode: mode, rest: REST });
  const info = await authInfo(a.address);
  const fee = stdFee(gas, feeUqor ?? Math.ceil(gas * 0.1) + 1000, granter);
  const signBytesVersion = mode === "hybrid" ? await signer.resolveSignBytesVersion(CHAIN_ID) : undefined;
  const signed = signer.sign({ chainId: CHAIN_ID, messages, fee, memo, accountNumber: info.accountNumber,
    sequence: sequence ?? info.sequence, signBytesVersion });
  return broadcastRaw(signed.txRawBytes, { wait });
}

export async function bankSend(a, to, uqor, opts = {}) {
  const messages = [{ typeUrl: "/cosmos.bank.v1beta1.MsgSend", value: { fromAddress: a.address, toAddress: to, amount: [{ denom: "uqor", amount: String(uqor) }] } }];
  return sendMsgs(a, messages, opts);
}

export async function registerKey(a) {
  const rec = await pqcRecord(a.address);
  if (rec.found) return { alreadyRegistered: true, possession_proven: rec.account?.possession_proven };
  const proofOfPossession = signProofOfPossession({ chainId: CHAIN_ID, account: a.address, keypair: a.pqc });
  const m = buildRegisterPqcKeyMsg(a.address, { pqcKeypair: a.pqc, proofOfPossession });
  const r = await sendMsgs(a, [m], { gas: 600000, feeUqor: 70000, mode: "classical" });
  return { alreadyRegistered: false, ...r };
}
