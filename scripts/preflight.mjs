// Pre-registration checklist (06-DRILL-RUNBOOK §1) and the pre-drill evidence snapshot (Phase 7.2).
//   node scripts/preflight.mjs               print every check; exit 1 if any FAIL
//   node scripts/preflight.mjs --snapshot    also write evidence/pre-drill.json (run it right before registering)
//   node scripts/preflight.mjs --post        write evidence/post-drill.json after the drill
import fs from "node:fs";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { getAddress } from "viem";
import * as c from "./lib/chain.mjs";
import { pub } from "./lib/evm.mjs";
import { evidence, hotArt, coldArt, ownerHeartbeatCalldata, guardianFreezeCalldata, vaultState } from "./lib/ops.mjs";

const POST = process.argv.includes("--post");
const SNAP = process.argv.includes("--snapshot") || POST;
const SNAPFILE = POST ? "evidence/post-drill.json" : "evidence/pre-drill.json";
const sh = (cmd) => { try { return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"], shell: "/bin/bash" }).toString().trim(); } catch { return ""; } };
const rows = []; const add = (level, name, detail = "") => { rows.push({ level, name, detail }); };
const ok = (name, d) => add("ok", name, d), warn = (name, d) => add("WARN", name, d), fail = (name, d) => add("FAIL", name, d);
const check = (cond, name, d = "", level = "FAIL") => (cond ? ok(name, d) : add(level, name, d));

const ev = evidence("phase4.json"); const funder = await c.loadAccount("funder"), drill = await c.loadAccount("drill");
const hot = ev.hot.address, cold = ev.cold.address, H = hotArt(), C = coldArt();
const snap = { at: new Date().toISOString() };

// ---- chain and clock ----
const head = await pub.getBlock(); const age = Math.abs(Date.now() / 1000 - Number(head.timestamp));
check(age < 30, "chain is live and the machine clock agrees with block time", `latest block ${Math.round(age)}s old`);
check(sh("timedatectl show -p NTPSynchronized --value") === "yes", "system clock is NTP-synchronised");
snap.chain = { height: Number(head.number), blockTime: new Date(Number(head.timestamp) * 1000).toISOString() };

// ---- drill account ----
const rec = await c.pqcRecord(drill.address);
check(rec.found && rec.account?.possession_proven === true && rec.account?.key_type === "hybrid", "drill account: ML-DSA-87 key registered with proof of possession", drill.address);
const dBal = await c.allBalances(drill.address); check(dBal.length === 0, "drill account holds nothing", JSON.stringify(dBal));
const dWin = await c.windowRecord(drill.address); check(dWin.found === false, "drill account has no EVM window");
const fWin = await c.windowRecord(funder.address); check(fWin.found === false, "funder has no EVM window open");
snap.drill = { address: drill.address, evm: drill.evm, pq: rec.account && { key_type: rec.account.key_type, possession_proven: rec.account.possession_proven }, balances: dBal, window: dWin.found };
const grant = await c.getJson(`/cosmos/feegrant/v1beta1/allowance/${funder.address}/${drill.address}`);
const ga = grant.body.allowance?.allowance; const types = ga?.allowed_messages ?? [];
check(types.length === 2 && types.includes("/cosmos.bank.v1beta1.MsgSend") && types.includes("/qorechain.crossvm.v1.MsgCrossVMCall"), "fee grant limited to MsgSend and MsgCrossVMCall", types.join(", "));
const left = BigInt(ga?.allowance?.spend_limit?.[0]?.amount ?? "0"); check(left >= 3_000_000n, "fee grant has at least 3 QOR left", `${left} uqor`);
snap.feeGrant = { allowedMessages: types, spendLeftUqor: left.toString(), expiration: ga?.allowance?.expiration };
const fUq = await c.balance(funder.address); check(fUq >= 10_000_000n, "funder keeps at least 10 QOR for fees", `${fUq} uqor`);
snap.funder = { address: funder.address, evm: funder.evm, uqor: fUq.toString() };

// ---- vaults ----
const r = (a, abi, fn, args = []) => pub.readContract({ address: a, abi, functionName: fn, args });
const hs = await vaultState(hot); const coldBal = await pub.getBalance({ address: cold });
check(hs.frozen === false, "hot vault is not frozen"); check(BigInt(hs.balanceWei) > 0n, "hot vault holds value", hs.balanceWei);
check(coldBal > 0n, "cold vault holds value", coldBal.toString());
check((await r(cold, C.abi, "RELEASE_TIME")) === 1795132800n, "cold vault release time is 20 Nov 2026 00:00 UTC");
check(getAddress(await r(hot, H.abi, "OWNER_ACCOUNT")) === getAddress(drill.evm), "hot vault owner account is the drill account");
check((await r(hot, H.abi, "allowedRecipient", [funder.evm])) && !(await r(hot, H.abi, "allowedRecipient", [drill.evm])) && !(await r(cold, C.abi, "allowedRecipient", [drill.evm])), "recipient allowlists contain the funder only, never the drill account");
const code = async (a, n) => { const art = n === "hot" ? H : C; const onchain = (await pub.getCode({ address: a })).toLowerCase(); let local = art.deployedBytecode.object.toLowerCase();
  for (const refs of Object.values(art.deployedBytecode.immutableReferences ?? {})) for (const { start, length } of refs) local = local.slice(0, 2 + start * 2) + onchain.slice(2 + start * 2, 2 + (start + length) * 2) + local.slice(2 + (start + length) * 2); return onchain === local; };
check(await code(hot, "hot") && await code(cold, "cold"), "deployed bytecode equals the build of the committed source");
snap.vaults = { hot: { address: hot, ...hs, limitsQOR: (await r(hot, H.abi, "limits", ["0x0000000000000000000000000000000000000000"])).map(String), timelockDelay: String(await r(hot, H.abi, "timelockDelay")) }, cold: { address: cold, balanceWei: coldBal.toString(), releaseTime: "1795132800" } };

// ---- readiness of the live actions (simulated, nothing is sent) ----
try { const hb = await ownerHeartbeatCalldata(hot, drill.pqc, 600); await pub.call({ account: drill.evm, to: hot, data: hb.data }); ok("proof-of-life heartbeat is accepted by the vault (simulated)"); } catch (e) { fail("proof-of-life heartbeat simulation", String(e.shortMessage ?? e.message).slice(0, 140)); }
try { const f = await guardianFreezeCalldata(hot, 600); await pub.call({ account: funder.evm, to: hot, data: f.data }); ok("guardian freeze is accepted by the vault (simulated)"); } catch (e) { fail("guardian freeze simulation", String(e.shortMessage ?? e.message).slice(0, 140)); }

// ---- evidence and repository ----
const log = evidence("attack-log.json"); check(log.verdict === "ALL BLOCKED", "latest live attack log verdict", log.verdict);
const rh = fs.existsSync("evidence/rehearsal-heartbeat.json") && evidence("rehearsal-heartbeat.json").confirmed; check(!!rh, "proof-of-life rehearsal landed on testnet");
const wt = fs.existsSync("evidence/watchtower-test.json") && Object.values(evidence("watchtower-test.json").result).every(Boolean); check(!!wt, "watchtower test (benign ignored, anomaly frozen) passed");
const dirty = sh("git status --porcelain | grep -v '^??' | wc -l"); const untracked = sh("git status --porcelain | grep '^??' | wc -l");
check(dirty === "0", "no uncommitted changes to tracked files", dirty + " modified"); if (untracked !== "0") warn("untracked files present", untracked + " (commit or ignore them)");
const local = sh("git rev-parse HEAD"), remote = sh("git rev-parse origin/main"); check(local === remote, "local HEAD is pushed to origin/main", `${local.slice(0, 7)} vs ${remote.slice(0, 7)}`, "WARN");
check(sh("gh repo view Abhishek222983101/kavach-vault --json visibility --jq .visibility") !== "", "GitHub repository reachable", sh("gh repo view Abhishek222983101/kavach-vault --json visibility --jq .visibility"), "WARN");
snap.repo = { head: local, originMain: remote, visibility: sh("gh repo view Abhishek222983101/kavach-vault --json visibility --jq .visibility") };

// ---- the keyless cloud backup (GitHub Actions keeper with pre-signed transactions) ----
try {
  const cfg = JSON.parse(fs.readFileSync("cloud/config.json", "utf8")); const b = cfg.baseline;
  const seqOf = async (a) => { const x = (await c.getJson(`/cosmos/auth/v1beta1/accounts/${a}`)).body.account; return String(x?.sequence ?? x?.base_account?.sequence ?? "0"); };
  const ownerNonce = String(await pub.readContract({ address: hot, abi: H.abi, functionName: "nonces", args: [1] }));
  check(cfg.hot === hot, "cloud keeper targets the real hot vault");
  check((await seqOf(drill.address)) === b.outerSeq, "cloud blobs are fresh: drill account sequence unchanged since pre-signing", `${b.outerSeq}`);
  check((await seqOf(cfg.freezer)) === b.freezerSeq, "cloud freeze blob is fresh: freezer sequence unchanged", `${b.freezerSeq}`);
  check(ownerNonce === b.ownerNonce, "cloud blobs are fresh: vault owner nonce unchanged", `${b.ownerNonce}`);
  const fz = await c.balance(cfg.freezer); check(fz >= 500000n, "freezer account can pay for the freeze", `${fz} uqor`);
  const secrets = sh("gh secret list --json name --jq '.[].name'").split("\n"); check(["HB_0", "HB_1", "HB_2", "FREEZE_TX"].every((n) => secrets.includes(n)), "GitHub secrets HB_0, HB_1, HB_2, FREEZE_TX are set", secrets.join(","));
  check(sh("git ls-tree origin/main .github/workflows/drill-keeper.yml") !== "", "keeper workflow is on origin/main");
  const lr = sh("gh run list --workflow drill-keeper.yml --limit 1 --json conclusion --jq '.[0].conclusion'"); check(lr === "success", "latest keeper run succeeded", lr || "no run yet", "WARN");
  snap.cloud = { baseline: b, secrets, lastRun: lr };
} catch (e) { fail("cloud keeper checks", String(e.message ?? e).slice(0, 140)); }

// ---- the machine ----
const timers = ["kavach-watchtower", "kavach-heartbeat", "kavach-heartbeat-retry", "kavach-heartbeat-extra", "kavach-go-public"];
snap.timers = {};
for (const t of timers) { const en = sh(`systemctl --user is-enabled ${t}.timer`), nx = sh(`systemctl --user show ${t}.timer -p NextElapseUSecRealtime --value`); snap.timers[t] = { enabled: en, next: nx }; check(en === "enabled", `timer ${t} is armed`, nx); }
check(sh("loginctl show-user $USER -p Linger --value") === "yes", "user services keep running when logged out (linger)");
check(sh("systemctl --user is-active kavach-awake.service") === "active", "sleep is blocked until the drill is over (kavach-awake)");
const free = Number(sh("df -Pm / | tail -1 | awk '{print $4}'")); check(free >= 2000, "at least 2 GB of disk free", `${free} MB`, free >= 800 ? "WARN" : "FAIL");
const ac = sh("cat /sys/class/power_supply/AC*/online 2>/dev/null | head -1"); check(ac === "1" || ac === "", "laptop is on mains power", ac === "" ? "no AC sensor found" : `AC online=${ac}`, "WARN");
snap.machine = { diskFreeMB: free, acOnline: ac, nodeVersion: process.version };
const manifest = {}; for (const f of fs.readdirSync("evidence").sort()) manifest[f] = crypto.createHash("sha256").update(fs.readFileSync("evidence/" + f)).digest("hex").slice(0, 16); snap.evidenceManifest = manifest;

const w = Math.max(...rows.map((x) => x.name.length));
for (const x of rows) console.log(`${x.level === "ok" ? "  ok  " : x.level === "WARN" ? " WARN " : " FAIL "} ${x.name.padEnd(w)}  ${x.detail}`);
const fails = rows.filter((x) => x.level === "FAIL").length, warns = rows.filter((x) => x.level === "WARN").length;
snap.checks = rows; snap.summary = { fails, warns, passed: rows.filter((x) => x.level === "ok").length };
if (SNAP) { fs.writeFileSync(SNAPFILE, JSON.stringify(snap, null, 2)); console.log("wrote " + SNAPFILE); }
console.log(`\n${snap.summary.passed} ok, ${warns} warnings, ${fails} failures`);
process.exit(fails ? 1 : 0);
