// Shared operations for the drill: a native (no EVM window) call into a vault, and state readers.
import fs from "node:fs";
import { encodeFunctionData } from "viem";
import * as c from "./chain.mjs";
import { pub } from "./evm.mjs";
import { sendMsgs } from "./native.mjs";
import { art, signRequest, chainNow, ACTION, ROLE, guardianKeypair, ZERO } from "./vault.mjs";

export const hotArt = () => art("KavachVault");
export const coldArt = () => art("KavachColdVault");
export const evidence = (f) => JSON.parse(fs.readFileSync(`evidence/${f}`, "utf8"));

/** A native MsgCrossVMCall from `from` into an EVM contract, fee paid by `granter`. No EVM window is involved. */
export async function nativeCall(from, target, data, { granter, gas = 1500000, feeUqor } = {}) {
  feeUqor ??= Math.ceil(gas * 0.11) + 1000; // the chain's minimum gas price is about 0.1 uqor per gas
  const m = c.msg.crossvm.crossVmCall({ sender: from.address, sourceVm: "cosmwasm", targetVm: "evm", targetContract: target, payload: c.fromHex(data) });
  return sendMsgs(from, [m], { gas, feeUqor, mode: "hybrid", granter });
}

export async function ownerHeartbeatCalldata(vault, ownerKp, ttlSeconds = 1800) {
  const abi = hotArt().abi;
  const deadline = (await chainNow()) + ttlSeconds;
  const s = await signRequest({ vault, abi, kp: ownerKp, action: ACTION.HEARTBEAT, role: ROLE.OWNER, deadline });
  return { data: encodeFunctionData({ abi, functionName: "heartbeat", args: [BigInt(deadline), s.pk, s.sig] }), deadline, nonce: s.nonce };
}

/** A guardian-signed freeze request, as calldata for `freeze(role, deadline, pk, sig)`. */
export async function guardianFreezeCalldata(vault, ttlSeconds = 1800) {
  const abi = hotArt().abi;
  const deadline = (await chainNow()) + ttlSeconds;
  const s = await signRequest({ vault, abi, kp: guardianKeypair(), action: ACTION.FREEZE, role: ROLE.GUARDIAN, deadline });
  return { data: encodeFunctionData({ abi, functionName: "freeze", args: [Number(ROLE.GUARDIAN), BigInt(deadline), s.pk, s.sig] }), deadline };
}

export async function vaultState(vault) {
  const abi = hotArt().abi;
  const r = (functionName, args = []) => pub.readContract({ address: vault, abi, functionName, args });
  return {
    balanceWei: (await pub.getBalance({ address: vault })).toString(),
    frozen: await r("frozen"),
    ownerNonce: (await r("nonces", [1])).toString(),
    guardianNonce: (await r("nonces", [2])).toString(),
    spent: (await r("spentInWindow", [ZERO])).toString(),
  };
}
