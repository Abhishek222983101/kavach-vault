import { AllowedMsgAllowance, BasicAllowance } from "cosmjs-types/cosmos/feegrant/v1beta1/feegrant";
import { MsgGrantAllowance, MsgRevokeAllowance } from "cosmjs-types/cosmos/feegrant/v1beta1/tx";
import { Timestamp } from "cosmjs-types/google/protobuf/timestamp";

/** AllowedMsgAllowance wrapping a BasicAllowance (spend limit + expiry) restricted to the given message type URLs. */
export function grantMsg({ granter, grantee, spendLimitUqor, expiry, allowedMessages }) {
  const basic = BasicAllowance.fromPartial({
    spendLimit: [{ denom: "uqor", amount: String(spendLimitUqor) }],
    expiration: Timestamp.fromPartial({ seconds: BigInt(Math.floor(expiry.getTime() / 1000)), nanos: 0 }),
  });
  const allowed = AllowedMsgAllowance.fromPartial({
    allowance: { typeUrl: "/cosmos.feegrant.v1beta1.BasicAllowance", value: BasicAllowance.encode(basic).finish() },
    allowedMessages,
  });
  return { typeUrl: "/cosmos.feegrant.v1beta1.MsgGrantAllowance",
    value: MsgGrantAllowance.fromPartial({ granter, grantee,
      allowance: { typeUrl: "/cosmos.feegrant.v1beta1.AllowedMsgAllowance", value: AllowedMsgAllowance.encode(allowed).finish() } }) };
}
export const revokeMsg = (granter, grantee) => ({ typeUrl: "/cosmos.feegrant.v1beta1.MsgRevokeAllowance", value: MsgRevokeAllowance.fromPartial({ granter, grantee }) });
