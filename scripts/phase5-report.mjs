// Phase 5.4: combine the three sweeps into evidence/attack-log.json and verify that the deployed bytecode is the committed source.
import fs from "node:fs";
import { execSync } from "node:child_process";
import { pub } from "./lib/evm.mjs";
import * as c from "./lib/chain.mjs";
const J = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const ev = J("evidence/phase4.json"), nat = J("evidence/attack-native.json"), evm = J("evidence/attack-evm.json"), vault = J("evidence/attack-vault.json"), canary = J("evidence/phase4b-cold-canary.json");

async function bytecodeMatches(address, name) {
  const a = J(`out/${name}.sol/${name}.json`); const chain = (await pub.getCode({ address })).toLowerCase();
  let local = a.deployedBytecode.object.toLowerCase();
  for (const refs of Object.values(a.deployedBytecode.immutableReferences ?? {})) for (const { start, length } of refs) {
    local = local.slice(0, 2 + start * 2) + chain.slice(2 + start * 2, 2 + (start + length) * 2) + local.slice(2 + (start + length) * 2);
  }
  // strip the metadata tail (CBOR hash) in case the compiler settings differ in path only
  return { equal: chain === local, chainBytes: (chain.length - 2) / 2 };
}
const hotM = await bytecodeMatches(ev.hot.address, "KavachVault"), coldM = await bytecodeMatches(ev.cold.address, "KavachColdVault");
const commit = execSync("git rev-parse HEAD").toString().trim(); const dirty = execSync("git status --porcelain src").toString().trim() !== "";
const nrows = nat.rows, pq = (r) => r.cls === "REFUSED_PQ" && (r.checkCode === 20 || r.checkCode === 234);
const log = {
  at: new Date().toISOString(), network: "qorechain-diana", commit, srcDirty: dirty,
  deployed: { hot: ev.hot.address, cold: ev.cold.address, hotBytecodeMatchesBuild: hotM.equal, coldBytecodeMatchesBuild: coldM.equal },
  native: { messageTypesInRegistry: nat.summary.messageTypes, attempts: nat.summary.attempts, accepted: nat.summary.accepted,
    refusedAtPqGate: nrows.filter(pq).length, refusedByStatelessValidationFirst: nrows.filter((r) => !pq(r)).length,
    handBuiltValidAttacks: nat.summary.handBuilt, handBuiltRefusedAtPqGate: nrows.filter((r) => r.name.startsWith("H") && pq(r)).length / 2,
    distinctTypesReachingPqGate: new Set(nrows.filter(pq).map((r) => r.name.replace(/^G /, ""))).size, unchanged: nat.summary.unchanged },
  evm: { attempts: evm.summary.attempts, accepted: evm.summary.accepted, refusedNoWindow_fundedStandIn: evm.summary.refusedNoWindow, refusedZeroBalance_drill: evm.summary.refusedFunds, accountsUnchanged: evm.summary.accountsUnchanged },
  vault: { callAttacks: vault.partA.attempts, allReverted: vault.partA.allReverted, controlsOk: vault.partA.controlsOk, live: vault.live.map((x) => ({ label: x.label, hash: x.hash, status: x.status })), checks: vault.final },
  coldCanary: { pass: canary.refusedWhileLocked && canary.attackerKeyRefusedAfterUnlock && canary.replayRefused && canary.release.status === "success", release: canary.release },
  state: { drillWindow: (await c.windowRecord((await c.loadAccount("drill")).address)).found, funderWindow: (await c.windowRecord((await c.loadAccount("funder")).address)).found,
    drillBalances: (await c.allBalances((await c.loadAccount("drill")).address)).length, hotWei: (await pub.getBalance({ address: ev.hot.address })).toString(), coldWei: (await pub.getBalance({ address: ev.cold.address })).toString() },
};
const ok = log.native.accepted === 0 && log.evm.accepted === 0 && log.vault.allReverted && log.vault.controlsOk && Object.values(log.vault.checks).every(Boolean) && log.coldCanary.pass &&
  log.deployed.hotBytecodeMatchesBuild && log.deployed.coldBytecodeMatchesBuild && !log.srcDirty && Object.values(log.native.unchanged).every(Boolean) && log.evm.accountsUnchanged.every(Boolean) &&
  log.state.drillWindow === false && log.state.funderWindow === false && log.state.drillBalances === 0;
log.verdict = ok ? "ALL BLOCKED" : "FAILED";
fs.writeFileSync("evidence/attack-log.json", JSON.stringify(log, null, 2));
console.log(JSON.stringify({ native: log.native, evm: log.evm, vault: { callAttacks: log.vault.callAttacks, allReverted: log.vault.allReverted }, deployed: log.deployed, state: log.state, verdict: log.verdict }, null, 1));
process.exit(ok ? 0 : 1);
