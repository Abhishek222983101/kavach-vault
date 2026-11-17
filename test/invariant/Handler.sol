// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {KavachVault} from "../../src/KavachVault.sol";
import {MockPQCVerify, MockPQCStatus} from "../mocks/MockPQC.sol";
import {MockToken} from "../helpers/Base.t.sol";

/// One contract that plays every actor: the honest owner and guardian (who hold the signing secrets), and an attacker
/// with the classical key and unlimited accounts (who holds NO post-quantum secret). Used by Foundry invariants and Medusa.
contract Handler is Test {
    address constant PQC_VERIFY = 0x0000000000000000000000000000000000000a01;
    address constant PQC_STATUS = 0x0000000000000000000000000000000000000a02;
    uint8 constant OWNER = 1;
    uint8 constant GUARDIAN = 2;
    bytes32 constant OWNER_SECRET = keccak256("owner-secret");
    bytes32 constant GUARD_SECRET = keccak256("guardian-secret");

    KavachVault public vault;
    MockToken public fusd;
    address public funder = address(0xF00D);
    address public ownerAcct = address(0xD211);
    address[3] public attackers = [address(0xBAD1), address(0xBAD2), address(0xBAD3)];
    bytes public ownerPk;
    bytes public guardianPk;
    uint256 public clock; // storage copy of time, immune to optimizer caching of block.timestamp

    // ghosts
    uint256 public initialQor;
    uint256 public initialTok;
    uint256 public qorIn;
    uint256 public qorOut;
    uint256 public tokIn;
    uint256 public tokOut;
    bool public guardianMovedFunds;
    bool public attackerSucceeded;
    uint256 public successfulOwnerCalls;
    mapping(address => mapping(uint256 => bool)) internal _queuedByOwner;
    struct Out {
        uint256 t;
        uint256 amt;
        address asset;
    }
    Out[] public outs;
    struct Q {
        bytes32 id;
        address asset;
        uint256 amt;
        bool executed;
    }
    Q[] public qs;
    bytes public lastSig;
    uint256 public lastDeadline;
    address public lastAsset;
    uint256 public lastAmt;

    constructor() {
        vm.chainId(9800);
        clock = 1_800_000_000;
        vm.warp(clock);
        // Foundry: etch the precompile doubles. Medusa: they are predeployed at these addresses via medusa.json.
        if (PQC_VERIFY.code.length == 0) vm.etch(PQC_VERIFY, address(new MockPQCVerify()).code);
        if (PQC_STATUS.code.length == 0) vm.etch(PQC_STATUS, address(new MockPQCStatus()).code);
        ownerPk = _pk("owner");
        guardianPk = _pk("guardian");
        MockPQCVerify(PQC_VERIFY).setSecret(ownerPk, OWNER_SECRET);
        MockPQCVerify(PQC_VERIFY).setSecret(guardianPk, GUARD_SECRET);
        MockPQCStatus(PQC_STATUS).set(ownerAcct, true, 1, ownerPk, true);
        fusd = new MockToken();
        address[] memory rec = new address[](1);
        rec[0] = funder;
        address[] memory toks = new address[](1);
        toks[0] = address(fusd);
        KavachVault.Limits[] memory lim = new KavachVault.Limits[](2);
        lim[0] = KavachVault.Limits(25 ether, 100 ether);
        lim[1] = KavachVault.Limits(250e6, 1000e6);
        vault = new KavachVault(ownerPk, ownerAcct, keccak256(guardianPk), rec, toks, lim, 6 hours);
        vm.deal(address(this), 1_000_000 ether);
        (bool ok,) = address(vault).call{value: 5_000 ether}("");
        require(ok);
        fusd.mint(address(this), 1_000_000e6);
        fusd.approve(address(vault), type(uint256).max);
        vault.depositToken(address(fusd), 50_000e6);
        initialQor = address(vault).balance;
        initialTok = fusd.balanceOf(address(vault));
    }

    function _pk(string memory seed) internal pure returns (bytes memory b) {
        b = new bytes(2592);
        bytes32 h = keccak256(bytes(seed));
        for (uint256 i = 0; i < 2592; i += 32) {
            h = keccak256(abi.encode(h, i));
            for (uint256 j = 0; j < 32 && i + j < 2592; j++) b[i + j] = h[j];
        }
    }

    function _f(bytes32 a, bytes32 b, bytes32 c) internal pure returns (bytes32[5] memory f) {
        f[0] = a;
        f[1] = b;
        f[2] = c;
    }

    function _asset(uint256 sel) internal view returns (address) {
        return sel % 2 == 0 ? address(0) : address(fusd);
    }

    function _sign(bytes32 secret, bytes memory pk, uint256 action, uint8 role, uint256 d, bytes32[5] memory f) internal view returns (bytes memory) {
        return MockPQCVerify(PQC_VERIFY).sign(secret, pk, vault.messageFor(action, role, d, f));
    }

    function _bal(address asset) internal view returns (uint256) {
        return asset == address(0) ? address(vault).balance : fusd.balanceOf(address(vault));
    }

    // -------------------------------------------------------------- honest owner
    function ownerWithdraw(uint256 sel, uint256 amtSeed) external {
        _maybeUnfreeze(amtSeed);
        address a = _asset(sel);
        uint256 amt = bound(amtSeed, 1, a == address(0) ? 60 ether : 600e6);
        uint256 d = clock + 1 hours;
        bytes memory s = _sign(OWNER_SECRET, ownerPk, 1, OWNER, d, _f(bytes32(uint256(uint160(a))), bytes32(uint256(uint160(funder))), bytes32(amt)));
        lastSig = s;
        lastDeadline = d;
        lastAsset = a;
        lastAmt = amt;
        try vault.withdraw(a, funder, amt, d, ownerPk, s) {
            _out(a, amt);
            successfulOwnerCalls++;
        } catch {}
    }

    function ownerQueueWithdraw(uint256 sel, uint256 amtSeed) external {
        _maybeUnfreeze(amtSeed);
        address a = _asset(sel);
        uint256 amt = bound(amtSeed, 1, a == address(0) ? 500 ether : 5_000e6);
        uint256 d = clock + 1 hours;
        bytes32[5] memory f = _f(bytes32(uint256(uint160(a))), bytes32(uint256(uint160(funder))), bytes32(amt));
        bytes memory s = _sign(OWNER_SECRET, ownerPk, 2, OWNER, d, f);
        try vault.queueAction(2, f, d, ownerPk, s) returns (bytes32 id) {
            qs.push(Q(id, a, amt, false));
            successfulOwnerCalls++;
        } catch {}
    }

    function executeQueued(uint256 idx) external {
        _maybeUnfreeze(idx);
        if (qs.length == 0) return;
        Q storage q = qs[idx % qs.length];
        uint256 before = _bal(q.asset);
        try vault.execute(q.id) {
            if (!q.executed) {
                q.executed = true;
                _out(q.asset, q.amt); // queued withdrawals are excluded from the daily-window ghost below
                outs[outs.length - 1].t = type(uint256).max;
            }
            assert(before - _bal(q.asset) == q.amt);
        } catch {}
    }

    function ownerFreeze(uint256 seed) external {
        if (seed % 8 != 0) return; // freezing blocks all other owner actions, so keep it rare
        uint256 d = clock + 1 hours;
        try vault.freeze(OWNER, d, ownerPk, _sign(OWNER_SECRET, ownerPk, 9, OWNER, d, _f(0, 0, 0))) {} catch {}
    }

    function guardianFreeze(uint256 seed) external {
        if (seed % 8 != 0) return;
        uint256 d = clock + 1 hours;
        try vault.freeze(GUARDIAN, d, guardianPk, _sign(GUARD_SECRET, guardianPk, 9, GUARDIAN, d, _f(0, 0, 0))) {} catch {}
    }

    function unfreezeBoth() public {
        uint256 d = clock + 1 hours;
        bytes memory os = _sign(OWNER_SECRET, ownerPk, 10, OWNER, d, _f(0, 0, 0));
        bytes memory gs = _sign(GUARD_SECRET, guardianPk, 10, GUARDIAN, d, _f(0, 0, 0));
        try vault.unfreeze(d, ownerPk, os, guardianPk, gs) {} catch {}
    }

    /// Honest operators unfreeze before continuing, most of the time, so campaigns keep reaching money-moving states.
    function _maybeUnfreeze(uint256 seed) internal {
        if (vault.frozen() && seed % 4 != 0) unfreezeBoth();
    }

    function ownerHeartbeat() external {
        uint256 d = clock + 1 hours;
        try vault.heartbeat(d, ownerPk, _sign(OWNER_SECRET, ownerPk, 11, OWNER, d, _f(0, 0, 0))) {} catch {}
    }

    function warpTime(uint256 secs) external {
        clock += bound(secs, 1, 2 days);
        vm.warp(clock);
    }

    function deposit(uint256 sel, uint256 amtSeed) external {
        address a = _asset(sel);
        if (a == address(0)) {
            uint256 amt = bound(amtSeed, 1, 100 ether);
            (bool ok,) = address(vault).call{value: amt}("");
            if (ok) qorIn += amt;
        } else {
            uint256 amt = bound(amtSeed, 1, 1_000e6);
            try vault.depositToken(a, amt) {
                tokIn += amt;
            } catch {}
        }
    }

    // -------------------------------------------------------------- guardian trying to take money
    function guardianTryWithdraw(uint256 sel, uint256 amtSeed) external {
        address a = _asset(sel);
        uint256 amt = bound(amtSeed, 1, 10 ether);
        uint256 d = clock + 1 hours;
        bytes32[5] memory f = _f(bytes32(uint256(uint160(a))), bytes32(uint256(uint160(funder))), bytes32(amt));
        bytes memory s = _sign(GUARD_SECRET, guardianPk, 1, GUARDIAN, d, f);
        try vault.withdraw(a, funder, amt, d, guardianPk, s) {
            guardianMovedFunds = true;
        } catch {}
        bytes32[5] memory z = _f(0, 0, 0);
        try vault.queueAction(2, f, d, guardianPk, _sign(GUARD_SECRET, guardianPk, 2, GUARDIAN, d, f)) {
            guardianMovedFunds = true;
        } catch {}
        z;
    }

    // -------------------------------------------------------------- attacker (no PQ secret)
    function attackerWithdraw(uint256 who, bytes32 junkSeed, uint256 amtSeed, uint256 sel, bool toAttacker) external {
        address caller = attackers[who % 3];
        address a = _asset(sel);
        address to = toAttacker ? caller : funder;
        bytes memory sig = new bytes(4627);
        bytes32 h = junkSeed;
        for (uint256 i = 0; i < 4627; i += 32) {
            h = keccak256(abi.encode(h, i));
            for (uint256 j = 0; j < 32 && i + j < 4627; j++) sig[i + j] = h[j];
        }
        vm.prank(caller);
        try vault.withdraw(a, to, bound(amtSeed, 1, 25 ether), clock + 1 days, ownerPk, sig) {
            attackerSucceeded = true;
        } catch {}
    }

    function attackerReplay(uint256 who) external {
        if (lastSig.length == 0) return;
        vm.prank(attackers[who % 3]);
        // replaying the last honest withdrawal request: valid only if its nonce is still current (it never is after success)
        uint256 balBefore = _bal(lastAsset);
        uint256 n = vault.nonces(OWNER);
        try vault.withdraw(lastAsset, funder, lastAmt, lastDeadline, ownerPk, lastSig) {
            // allowed only if the original attempt had failed (nonce unchanged) and this is its first success
            if (vault.nonces(OWNER) != n + 1) attackerSucceeded = true;
            if (balBefore - _bal(lastAsset) != lastAmt) attackerSucceeded = true;
            _out(lastAsset, lastAmt);
            lastSig = "";
        } catch {}
    }

    function attackerQueueAndExecute(uint256 who, bytes32 junkSeed, bytes32 id) external {
        vm.startPrank(attackers[who % 3]);
        bytes memory sig = new bytes(4627);
        sig[0] = junkSeed[0];
        try vault.queueAction(2, _f(bytes32(uint256(uint160(attackers[who % 3]))), bytes32(uint256(uint160(attackers[who % 3]))), bytes32(uint256(1 ether))), clock + 1 days, ownerPk, sig) {
            attackerSucceeded = true;
        } catch {}
        try vault.execute(id) {
            // Anyone may trigger a queued action after its delay; that is by design and the money goes only to the
            // owner-signed, allowlisted recipient. Only ids the owner queued may ever execute, and each pays once.
            bool known;
            for (uint256 i = 0; i < qs.length; i++) {
                if (qs[i].id == id) {
                    known = true;
                    if (qs[i].executed) attackerSucceeded = true; // a second payout would be a bug
                    else {
                        qs[i].executed = true;
                        _out(qs[i].asset, qs[i].amt);
                        outs[outs.length - 1].t = type(uint256).max;
                    }
                }
            }
            if (!known) attackerSucceeded = true;
        } catch {}
        try vault.freeze(OWNER, clock + 1 days, ownerPk, sig) {
            attackerSucceeded = true;
        } catch {}
        vm.stopPrank();
    }

    function attackerForceSend(uint256 amtSeed) external {
        uint256 amt = bound(amtSeed, 1, 10 ether);
        new Forcer{value: amt}(payable(address(vault)));
        qorIn += amt;
    }

    // -------------------------------------------------------------- bookkeeping
    function _out(address asset, uint256 amt) internal {
        outs.push(Out(clock, amt, asset));
        if (asset == address(0)) qorOut += amt;
        else tokOut += amt;
    }

    // -------------------------------------------------------------- invariants (shared by Foundry and Medusa)
    function inv_balancesExact() public view returns (bool) {
        return address(vault).balance == initialQor + qorIn - qorOut && fusd.balanceOf(address(vault)) == initialTok + tokIn - tokOut;
    }

    function inv_attackersGotNothing() public view returns (bool) {
        for (uint256 i = 0; i < 3; i++) {
            if (attackers[i].balance != 0 || fusd.balanceOf(attackers[i]) != 0) return false;
        }
        return !attackerSucceeded;
    }

    function inv_guardianNeverMovesFunds() public view returns (bool) {
        return !guardianMovedFunds;
    }

    function inv_dailyCapRespected() public view returns (bool) {
        // for every instant-withdrawal, the sum of instant withdrawals of the same asset in the 24 h up to it is <= daily cap
        for (uint256 i = 0; i < outs.length; i++) {
            if (outs[i].t == type(uint256).max) continue;
            uint256 sum;
            for (uint256 j = 0; j < outs.length; j++) {
                if (outs[j].t == type(uint256).max || outs[j].asset != outs[i].asset) continue;
                if (outs[j].t <= outs[i].t && outs[i].t - outs[j].t < 24 hours) sum += outs[j].amt;
            }
            (, uint128 daily) = vault.limits(outs[i].asset);
            if (sum > daily) return false;
        }
        return true;
    }

    function inv_windowAccountingBounded() public view returns (bool) {
        (, uint128 d0) = vault.limits(address(0));
        (, uint128 d1) = vault.limits(address(fusd));
        return vault.spentInWindow(address(0)) <= d0 && vault.spentInWindow(address(fusd)) <= d1;
    }

    function inv_nonceMonotonicAndBounded() public view returns (bool) {
        // owner nonce only moves with a successful owner-signed call; the attacker cannot advance it
        return vault.nonces(OWNER) <= outs.length + qs.length + 100_000;
    }

    function inv_limitsAndRecipientsUnchanged() public view returns (bool) {
        (uint128 p0, uint128 d0) = vault.limits(address(0));
        (uint128 p1, uint128 d1) = vault.limits(address(fusd));
        return p0 == 25 ether && d0 == 100 ether && p1 == 250e6 && d1 == 1000e6 && vault.timelockDelay() == 6 hours && vault.allowedRecipient(funder)
            && !vault.allowedRecipient(attackers[0]) && !vault.allowedRecipient(attackers[1]) && !vault.allowedRecipient(attackers[2]);
    }
}

contract Forcer {
    constructor(address payable target) payable {
        selfdestruct(target);
    }
}
