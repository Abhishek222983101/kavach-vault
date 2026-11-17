#!/usr/bin/env python3
"""Mutation testing: break the contracts on purpose, one change at a time, and require the test suite to notice.
A surviving mutant means a missing test. Writes evidence/mutation-report.md. Restores the sources afterwards."""
import subprocess, shutil, sys, os, datetime
ENV = dict(os.environ, PATH=os.path.expanduser("~/.foundry/bin") + ":" + os.environ["PATH"])
HOT, COLD = "src/KavachVault.sol", "src/KavachColdVault.sol"
M = [
 ("hot: frozen no longer blocks withdraw", HOT, "        if (frozen) revert Frozen();\n        if (!listedAsset[asset]) revert NotListed();", "        if (!listedAsset[asset]) revert NotListed();"),
 ("hot: reentrancy guard removed from withdraw", HOT, "        external\n        nonReentrant\n    {\n        if (frozen) revert Frozen();\n        if (!listedAsset[asset])", "        external\n    {\n        if (frozen) revert Frozen();\n        if (!listedAsset[asset])"),
 ("hot: nonce not consumed", HOT, "        nonces[role] = nonce + 1;", "        // nonces[role] = nonce + 1;"),
 ("hot: pinned key hash check removed", HOT, "        if (pkHash != (role == ROLE_OWNER ? OWNER_KEY_HASH : GUARDIAN_KEY_HASH)) revert BadKey();", ""),
 ("hot: deadline check removed", HOT, "        if (deadline < block.timestamp) revert Expired();\n        if (pk.length != PK_LEN", "        if (pk.length != PK_LEN"),
 ("hot: recipient allowlist removed", HOT, "        if (!allowedRecipient[to]) revert NotAllowed();\n        if (amount == 0) revert ZeroAmount();\n        Limits memory l", "        if (amount == 0) revert ZeroAmount();\n        Limits memory l"),
 ("hot: daily accounting skipped", HOT, "        _spend(asset, amount, l.daily); // effects before the transfer", ""),
 ("hot: per-tx cap removed", HOT, "        if (amount > l.perTx) revert OverPerTx();", ""),
 ("hot: live key-status check removed", HOT, "        if (role == ROLE_OWNER) {\n            (bool reg, uint8 algo, bytes memory onchain, bool pop) = PQC_STATUS.pqcKeyStatus(OWNER_ACCOUNT);\n            if (!(reg && algo == ALGO_MLDSA87 && pop && keccak256(onchain) == OWNER_KEY_HASH)) revert KeyStatus();\n        }", ""),
 ("hot: proof-of-possession not required (runtime)", HOT, "if (!(reg && algo == ALGO_MLDSA87 && pop && keccak256(onchain) == OWNER_KEY_HASH)) revert KeyStatus();", "if (!(reg && algo == ALGO_MLDSA87 && keccak256(onchain) == OWNER_KEY_HASH)) revert KeyStatus();"),
 ("hot: signature verification result ignored", HOT, "        if (!PQC.pqcVerify(pk, sig, m)) revert BadSignature();", "        PQC.pqcVerify(pk, sig, m);"),
 ("hot: chain id dropped from message", "src/libs/KavachMessage.sol", "abi.encode(domain, block.chainid, vault,", "abi.encode(domain, uint256(9800), vault,"),
 ("hot: vault address dropped from message", "src/libs/KavachMessage.sol", "abi.encode(domain, block.chainid, vault,", "abi.encode(domain, block.chainid, address(0),"),
 ("hot: timelock ignored on execute", HOT, "        if (block.timestamp < q.eta) revert NotReady();", ""),
 ("hot: executed entries can run twice", HOT, "        if (q.done) revert AlreadyDone();\n        if (block.timestamp < q.eta) revert NotReady();\n        q.done = true;", "        if (block.timestamp < q.eta) revert NotReady();"),
 ("hot: guardian accepted for withdraw", HOT, "        uint256 nonce = _auth(ROLE_OWNER, A_WITHDRAW,", "        uint256 nonce = _auth(ROLE_GUARDIAN, A_WITHDRAW,"),
 ("hot: unfreeze needs only the owner", HOT, "        _auth(ROLE_GUARDIAN, A_UNFREEZE, deadline, guardianPk, guardianSig, _f3(0, 0, 0));", ""),
 ("hot: fallback accepts calls", HOT, "    fallback() external payable {\n        revert();\n    }", "    fallback() external payable {}"),
 ("hot: token deposit accepts unlisted tokens", HOT, "        if (token == QOR || !listedAsset[token]) revert NotListed();", ""),
 ("hot: heartbeat blocked while frozen", HOT, "        uint256 n = _auth(ROLE_OWNER, A_HEARTBEAT,", "        if (frozen) revert Frozen();\n        uint256 n = _auth(ROLE_OWNER, A_HEARTBEAT,"),
 ("hot: reentrancy guard removed from execute", HOT, "function execute(bytes32 id) external nonReentrant {", "function execute(bytes32 id) external {"),
 ("cold: lock check removed", COLD, "        if (block.timestamp < RELEASE_TIME) revert Locked();\n", ""),
 ("cold: lock off by one hour", COLD, "        if (block.timestamp < RELEASE_TIME) revert Locked();", "        if (block.timestamp + 1 hours < RELEASE_TIME) revert Locked();"),
 ("cold: key pin removed", COLD, "        if (keccak256(pk) != OWNER_KEY_HASH) revert BadKey();", ""),
 ("cold: allowlist removed", COLD, "        if (!allowedRecipient[to]) revert NotAllowed();", ""),
 ("cold: nonce not consumed", COLD, "        nonce = n + 1;", ""),
 ("cold: hot domain accepted", COLD, "KavachMessage.COLD_DOMAIN, address(this), A_RELEASE", "KavachMessage.HOT_DOMAIN, address(this), A_RELEASE"),
]
M = [(n, f, o, nw) for (n, f, o, nw) in M]
def run():
    r = subprocess.run(["forge", "test", "--no-match-contract", "InvariantsTest"], capture_output=True, text=True, env=ENV)
    return r.returncode, r.stdout[-400:]
rows = []
orig = {f: open(f).read() for f in {HOT, COLD, "src/libs/KavachMessage.sol"}}
try:
    code, _ = run(); assert code == 0, "baseline suite must be green before mutating"
    for name, f, old, new in M:
        src = orig[f]
        if old not in src: rows.append((name, "SKIPPED (pattern not found)")); continue
        open(f, "w").write(src.replace(old, new, 1))
        code, out = run()
        rows.append((name, "killed" if code != 0 else "SURVIVED"))
        open(f, "w").write(src)
        print(rows[-1], flush=True)
finally:
    for f, s in orig.items(): open(f, "w").write(s)
killed = sum(1 for _, s in rows if s == "killed"); total = len(rows)
with open("evidence/mutation-report.md", "w") as fh:
    fh.write(f"# Mutation testing\n\nRun {datetime.datetime.now(datetime.timezone.utc).isoformat()}Z. Each row breaks the contract on purpose; the test suite (everything except the long invariant campaign) must fail.\n\n**{killed} of {total} mutants killed.**\n\n| Mutation | Result |\n|---|---|\n")
    for n, s in rows: fh.write(f"| {n} | {s} |\n")
print(f"\n{killed}/{total} killed")
sys.exit(0 if killed == total else 1)
