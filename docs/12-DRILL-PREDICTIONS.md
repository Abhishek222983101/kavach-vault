# Drill predictions (written during the drill, before the attack log is published)

The organisers publish the full attack log after the drill. This file states, in advance, what we expect every attack
to achieve and exactly where it stops. After the log is published we compare it line by line (section 4) and keep this
file unchanged, so the prediction can be checked against the result. The GitHub push time of this file is the record of
when it was written.

Drill: 18 Nov 2026, 00:00 to 23:59 UTC. Ranking: proof of life, then fewest successful attacks, then most value kept
(the drill account's balance after ÷ before, worst asset), then the jury on the threat model.

## 1. State at the start of the drill

| What | Value | Check |
|---|---|---|
| Drill account | `qor1hk8vnarknzqjd3aa8hcsumxx6l3e6g7zwd2pzp` / `0xbd8EC9F476988126C7bd3dF10e6cC6d7e39d23C2` | ML-DSA-87 key registered with proof of possession (`evidence/phase2.json`) |
| Drill account balance | 1 QOR (1,000,000 uqor), no other asset | funded 17 Nov, tx `0F5BD9C99DA187B2F095B91027C21ABEF78CD8ECE39ABF9F58777D64D28D00AE` |
| EVM window on the drill account | none, and never opened | `/qorechain/pqc/v1/evm_window/<drill>` returns `found: false` |
| Hot vault `0x10256EDD0877436FfCBA8A62b0598f4bAD01514B` | 129 QOR, not frozen | |
| Cold vault `0x3Fc71aF5bADd701FF7D718df932E0dDf8612149F` | 740 QOR, release time 20 Nov 2026 00:00 UTC | |
| Proof of life | `80517F8F25FF933772FF9789BFAFA648D5AD9D92C6DE893561C9B4C4CFB129BF`, 00:01:03 UTC, code 0, sender = drill account, accepted on the project page | `evidence/proof-of-life.json` |

## 2. Predictions for the attacks the rules name

The rules say the bot tries "native transfers, opening EVM windows, EVM transfers, token approvals and drain calls on
the team's contracts", using the drill account's classical (secp256k1) key alone.

| # | Attack | Prediction | Where it stops, and why | Evidence from our own sweep before the drill |
|---|---|---|---|---|
| P1 | Native transfer of the 1 QOR (`MsgSend`), signed with the classical key only | **Refused. 0 succeed. Balance stays 1,000,000 uqor.** | The chain's post-quantum gate: the account has a registered hybrid ML-DSA-87 key, so every native transaction needs the ML-DSA-87 signature as well. Refused before execution, so no fee is charged and the sequence does not move. | `evidence/attack-native.json`: 298 classical-only transactions, one per message type in the SDK registry plus 14 hand-built valid ones; 0 accepted, 168 refused at the PQ gate, the rest refused earlier by validation. Balance, sequence and key unchanged. |
| P2 | Open an EVM window (`MsgOpenEvmWindow`), unscoped or scoped to our vaults | **Refused. 0 succeed. No window record appears.** | Same post-quantum gate: opening a window is itself a native transaction. | Attacks H3 and H4 in the native sweep; `drillWindow` unchanged. |
| P3 | EVM transfer from `0xbd8E…23C2` | **Refused. 0 succeed.** | With no window, the EVM lane does not accept transactions from this account. | `evidence/attack-evm.json`: 34 attempts, 0 accepted; 17 from a funded stand-in account with no window, 17 from the drill account. |
| P4 | Token approvals (`approve`, `permit`) on fUSD, fETH, fBTC | **Refused. 0 succeed.** | An approval is an EVM transaction, so it is stopped exactly like P3. The account also holds no tokens, so an approval could not move anything even if it landed. | covered by the EVM sweep |
| P5 | Drain calls on the hot vault (`withdraw`, `execute`, `queueAction`, rule changes, `freeze`/`unfreeze`) | **All revert. Hot vault stays at 129 QOR. Spend counter unchanged.** | The vault never looks at the caller. Every action needs an ML-DSA-87 signature by the owner's pinned key over the exact asset, recipient, amount, nonce, deadline, chain and vault. The bot has no ML-DSA-87 key. Revert reasons recorded in our sweep: `BadKey` 24, `BadSignature` 22, `NotListed` 8, `UnknownAction` 6, `Locked` 6, `NotAllowed` 4, `Expired` 2, `OverPerTx` 2, other 4. | `evidence/attack-vault.json`: 78 call attacks from a random address and from the drill address, all reverted, balances unchanged. |
| P6 | Drain calls on the cold vault | **All revert. Cold vault stays at 740 QOR.** | Same signature rule, plus nothing can leave before 20 Nov 2026 00:00 UTC. | same file; cold-vault canary in `evidence/phase4b-cold-canary.json` |

## 3. Attacks the bot might add, and what we expect

| # | Attack | Prediction | Why |
|---|---|---|---|
| P7 | Spend our fee grant with classical-only transactions | **Grant unchanged.** | Refused at the PQ gate before fees are taken. Sweep C2 in `evidence/attack-native.json` sent every message type with our grant attached; the grant did not move. |
| P8 | `authz` grant, fee grant from the drill account, replacing or adding a post-quantum key | **Refused.** | All native, all stopped at the PQ gate (hand-built attacks H5, H9, H10). |
| P9 | Replay an old signed vault request | **Reverts.** | Each request is bound to one nonce and one deadline; the nonce has already moved. |
| P10 | Copy a fresh vault signature from the mempool and send it first | **Moves nothing.** At most it spends a heartbeat nonce. | Only our own heartbeats carry fresh signatures, and a heartbeat moves no value. Our proof had already landed at 00:01 UTC. We switched off the optional extra heartbeats during the drill so no new signature is broadcast. |
| P11 | Send funds **to** the drill account or the vaults | **Allowed, and harmless.** | Incoming funds cannot lower the share kept. |

**Overall prediction: 0 successful attacks, 100% of the drill account's value kept (1 QOR before, 1 QOR after), both
vaults unchanged, proof of life accepted.**

What could make this wrong: a bug in the chain's own post-quantum gate or EVM lane, which is outside our code. If it
happens, the watchtower freezes the hot vault within seconds (`evidence/watchtower-test.json`), and the cold vault cannot
move before 20 Nov in any case.

## 4. Comparison with the organisers' attack log (filled in after the drill)

| # | Predicted | Observed in the organisers' log | Match |
|---|---|---|---|
| P1 to P11 | see above | _pending_ | _pending_ |
