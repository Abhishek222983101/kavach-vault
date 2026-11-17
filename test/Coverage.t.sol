// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base, MockToken} from "./helpers/Base.t.sol";
import {KavachVault} from "../src/KavachVault.sol";
import {KavachColdVault} from "../src/KavachColdVault.sol";
import {MockPQCStatus} from "./mocks/MockPQC.sol";

contract RejectETH {
    receive() external payable {
        revert();
    }
}

contract FalseToken {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 a) external {
        balanceOf[to] += a;
    }

    function transferFrom(address f, address t, uint256 a) external returns (bool) {
        balanceOf[f] -= a;
        balanceOf[t] += a;
        return true;
    }

    function transfer(address, uint256) external pure returns (bool) {
        return false; // pays nothing and says so
    }
}

contract FalseFromToken {
    function balanceOf(address) external pure returns (uint256) {
        return 0;
    }

    function transferFrom(address, address, uint256) external pure returns (bool) {
        return false;
    }
}

/// Branch-driven tests: every revert path and every queue action of both vaults, with the exact error asserted.
contract HotBranches is Base {
    // ---- constructor ---------------------------------------------------------------------------------
    function _rec() internal view returns (address[] memory r) {
        r = new address[](1);
        r[0] = funder;
    }

    function _toks() internal view returns (address[] memory t) {
        t = new address[](1);
        t[0] = address(fusd);
    }

    function _lim(uint256 n) internal pure returns (KavachVault.Limits[] memory l) {
        l = new KavachVault.Limits[](n);
        for (uint256 i = 0; i < n; i++) l[i] = KavachVault.Limits(1 ether, 2 ether);
    }

    function test_ctor_badOwnerKeyLength() public {
        address[] memory r = _rec();
        address[] memory t = _toks();
        KavachVault.Limits[] memory l = _lim(2);
        bytes memory shortPk = new bytes(100);
        vm.expectRevert(KavachVault.BadConfig.selector);
        new KavachVault(shortPk, ownerAcct, keccak256(guardianPk), r, t, l, 6 hours);
    }

    function test_ctor_zeroOwnerAccount() public {
        address[] memory r = _rec();
        address[] memory t = _toks();
        KavachVault.Limits[] memory l = _lim(2);
        vm.expectRevert(KavachVault.BadConfig.selector);
        new KavachVault(ownerPk, address(0), keccak256(guardianPk), r, t, l, 6 hours);
    }

    function test_ctor_guardianHashZeroOrSameAsOwner() public {
        address[] memory r = _rec();
        address[] memory t = _toks();
        KavachVault.Limits[] memory l = _lim(2);
        vm.expectRevert(KavachVault.BadConfig.selector);
        new KavachVault(ownerPk, ownerAcct, bytes32(0), r, t, l, 6 hours);
        bytes32 ownerHash = keccak256(ownerPk);
        vm.expectRevert(KavachVault.BadConfig.selector);
        new KavachVault(ownerPk, ownerAcct, ownerHash, r, t, l, 6 hours);
    }

    function test_ctor_delayOutOfRange() public {
        address[] memory r = _rec();
        address[] memory t = _toks();
        KavachVault.Limits[] memory l = _lim(2);
        vm.expectRevert(KavachVault.BadConfig.selector);
        new KavachVault(ownerPk, ownerAcct, keccak256(guardianPk), r, t, l, 59 minutes);
        vm.expectRevert(KavachVault.BadConfig.selector);
        new KavachVault(ownerPk, ownerAcct, keccak256(guardianPk), r, t, l, 8 days);
    }

    function test_ctor_limitsLengthMustMatchTokens() public {
        address[] memory r = _rec();
        address[] memory t = _toks();
        KavachVault.Limits[] memory l = _lim(3);
        vm.expectRevert(KavachVault.BadConfig.selector);
        new KavachVault(ownerPk, ownerAcct, keccak256(guardianPk), r, t, l, 6 hours);
    }

    function _build(address a) internal returns (KavachVault) {
        return new KavachVault(ownerPk, a, keccak256(guardianPk), _rec(), _toks(), _lim(2), 6 hours);
    }

    function test_ctor_keyStatus_notRegistered() public {
        vm.expectRevert(KavachVault.KeyStatus.selector);
        this.buildExt(address(0xAA01));
    }

    function buildExt(address a) external returns (KavachVault) {
        return _build(a);
    }

    function test_ctor_keyStatus_wrongAlgorithmOrNoPossession() public {
        address a = address(0xAA01);
        MockPQCStatus(PQC_STATUS).set(a, true, 2, ownerPk, true);
        vm.expectRevert(KavachVault.KeyStatus.selector);
        this.buildExt(a);
        MockPQCStatus(PQC_STATUS).set(a, true, 1, ownerPk, false);
        vm.expectRevert(KavachVault.KeyStatus.selector);
        this.buildExt(a);
    }

    function test_ctor_keyStatus_differentKey() public {
        address a = address(0xAA01);
        MockPQCStatus(PQC_STATUS).set(a, true, 1, attackerPk, true);
        vm.expectRevert(KavachVault.KeyStatus.selector);
        this.buildExt(a);
    }

    function test_ctor_zeroOrDuplicateTokenAndZeroRecipient() public {
        address[] memory r = _rec();
        KavachVault.Limits[] memory l = _lim(3);
        address[] memory dup = new address[](2);
        dup[0] = address(fusd);
        dup[1] = address(fusd);
        vm.expectRevert(KavachVault.BadConfig.selector);
        new KavachVault(ownerPk, ownerAcct, keccak256(guardianPk), r, dup, l, 6 hours);
        address[] memory zero = new address[](2);
        zero[0] = address(fusd);
        vm.expectRevert(KavachVault.BadConfig.selector);
        new KavachVault(ownerPk, ownerAcct, keccak256(guardianPk), r, zero, l, 6 hours);
        address[] memory badRec = new address[](1);
        address[] memory t = _toks();
        KavachVault.Limits[] memory l2 = _lim(2);
        vm.expectRevert(KavachVault.BadConfig.selector);
        new KavachVault(ownerPk, ownerAcct, keccak256(guardianPk), badRec, t, l2, 6 hours);
    }

    // ---- queue actions ---------------------------------------------------------------------------------
    function _queue(uint256 action, bytes32[5] memory f) internal returns (bytes32 id) {
        uint256 d = ts() + 1 hours;
        id = vault.queueAction(action, f, d, ownerPk, ownerSig(action, d, f));
    }

    function _ready() internal {
        vm.warp(ts() + 6 hours + 1);
    }

    function test_exec_queuedWithdraw_badTargetsAndAmounts() public {
        bytes32 unlisted = _queue(A_QWITHDRAW, f3(addr32(address(0xDEAD)), addr32(funder), bytes32(uint256(1))));
        bytes32 notAllowed = _queue(A_QWITHDRAW, f3(addr32(address(0)), addr32(attacker), bytes32(uint256(1))));
        bytes32 zero = _queue(A_QWITHDRAW, f3(addr32(address(0)), addr32(funder), bytes32(uint256(0))));
        _ready();
        vm.expectRevert(KavachVault.NotListed.selector);
        vault.execute(unlisted);
        vm.expectRevert(KavachVault.NotAllowed.selector);
        vault.execute(notAllowed);
        vm.expectRevert(KavachVault.ZeroAmount.selector);
        vault.execute(zero);
    }

    function test_exec_queuedLimits_changesRulesOnlyAfterDelay() public {
        bytes32 id = _queue(A_QLIMITS, f3(addr32(address(0)), bytes32(uint256(5 ether)), bytes32(uint256(10 ether))));
        (uint128 p0, uint128 d0) = vault.limits(address(0));
        assertEq(p0, 25 ether);
        assertEq(d0, 100 ether);
        vm.expectRevert(KavachVault.NotReady.selector);
        vault.execute(id);
        _ready();
        vault.execute(id);
        (uint128 p1, uint128 d1) = vault.limits(address(0));
        assertEq(p1, 5 ether);
        assertEq(d1, 10 ether);
        vm.expectRevert(KavachVault.AlreadyDone.selector);
        vault.execute(id);
        // the new cap binds
        uint256 d = ts() + 1 hours;
        bytes memory s = ownerSig(A_WITHDRAW, d, f3(addr32(address(0)), addr32(funder), bytes32(uint256(6 ether))));
        vm.expectRevert(KavachVault.OverPerTx.selector);
        vault.withdraw(address(0), funder, 6 ether, d, ownerPk, s);
    }

    function test_exec_queuedLimits_badInputs() public {
        bytes32 unlisted = _queue(A_QLIMITS, f3(addr32(address(0xDEAD)), bytes32(uint256(1)), bytes32(uint256(2))));
        bytes32 huge = _queue(A_QLIMITS, f3(addr32(address(0)), bytes32(uint256(type(uint128).max) + 1), bytes32(uint256(2))));
        bytes32 huge2 = _queue(A_QLIMITS, f3(addr32(address(0)), bytes32(uint256(1)), bytes32(uint256(type(uint128).max) + 1)));
        _ready();
        vm.expectRevert(KavachVault.NotListed.selector);
        vault.execute(unlisted);
        vm.expectRevert(KavachVault.BadConfig.selector);
        vault.execute(huge);
        vm.expectRevert(KavachVault.BadConfig.selector);
        vault.execute(huge2);
    }

    function test_exec_queuedRecipient_addRemoveAndZero() public {
        address newR = address(0xBEEF);
        bytes32 add = _queue(A_QRECIP, f3(addr32(newR), bytes32(uint256(1)), 0));
        bytes32 zero = _queue(A_QRECIP, f3(addr32(address(0)), bytes32(uint256(1)), 0));
        _ready();
        assertFalse(vault.allowedRecipient(newR));
        vault.execute(add);
        assertTrue(vault.allowedRecipient(newR));
        vm.expectRevert(KavachVault.BadConfig.selector);
        vault.execute(zero);
        bytes32 rm = _queue(A_QRECIP, f3(addr32(newR), bytes32(uint256(0)), 0));
        _ready();
        vault.execute(rm);
        assertFalse(vault.allowedRecipient(newR));
    }

    function test_exec_queuedDelay_validAndInvalid() public {
        bytes32 ok = _queue(A_QDELAY, f3(bytes32(uint256(2 hours)), 0, 0));
        bytes32 low = _queue(A_QDELAY, f3(bytes32(uint256(30 minutes)), 0, 0));
        bytes32 high = _queue(A_QDELAY, f3(bytes32(uint256(30 days)), 0, 0));
        _ready();
        vault.execute(ok);
        assertEq(vault.timelockDelay(), 2 hours);
        vm.expectRevert(KavachVault.BadConfig.selector);
        vault.execute(low);
        vm.expectRevert(KavachVault.BadConfig.selector);
        vault.execute(high);
        // the next queued action uses the new delay
        bytes32 next = _queue(A_QRECIP, f3(addr32(address(0xCAFE)), bytes32(uint256(1)), 0));
        vm.warp(ts() + 2 hours - 1);
        vm.expectRevert(KavachVault.NotReady.selector);
        vault.execute(next);
        vm.warp(ts() + 2);
        vault.execute(next);
    }

    function test_exec_blockedWhileFrozen_unknownId_andCancelPaths() public {
        bytes32 id = _queue(A_QRECIP, f3(addr32(address(0xCAFE)), bytes32(uint256(1)), 0));
        _ready();
        uint256 d = ts() + 1 hours;
        vault.freeze(OWNER, d, ownerPk, ownerSig(A_FREEZE, d, f3(0, 0, 0)));
        vm.expectRevert(KavachVault.Frozen.selector);
        vault.execute(id);
        vm.expectRevert(KavachVault.Frozen.selector);
        vault.queueAction(A_QRECIP, f3(0, 0, 0), d, ownerPk, "");
        // cancel is allowed while frozen; unknown ids and finished ids are refused
        bytes32 unknown = keccak256("nothing");
        vm.expectRevert(KavachVault.UnknownAction.selector);
        vault.cancel(unknown, GUARDIAN, d, guardianPk, "");
        d = ts() + 1 hours;
        vault.cancel(id, GUARDIAN, d, guardianPk, guardianSig(A_CANCEL, d, f3(id, 0, 0)));
        d = ts() + 1 hours;
        bytes memory again = guardianSig(A_CANCEL, d, f3(id, 0, 0)); // signed before expectRevert, which the helper call would consume
        vm.expectRevert(KavachVault.AlreadyDone.selector);
        vault.cancel(id, GUARDIAN, d, guardianPk, again);
    }

    function test_queueAction_rejectsNonQueueableActions() public {
        uint256 d = ts() + 1 hours;
        uint256[4] memory bad = [A_WITHDRAW, A_HEARTBEAT, A_FREEZE, uint256(99)];
        for (uint256 i = 0; i < bad.length; i++) {
            vm.expectRevert(KavachVault.UnknownAction.selector);
            vault.queueAction(bad[i], f3(0, 0, 0), d, ownerPk, "");
        }
    }

    // ---- payment failures ------------------------------------------------------------------------------
    function _vaultWith(address recipient, address token) internal returns (KavachVault v) {
        address[] memory r = new address[](1);
        r[0] = recipient;
        address[] memory t = new address[](1);
        t[0] = token;
        v = new KavachVault(ownerPk, ownerAcct, keccak256(guardianPk), r, t, _lim(2), 6 hours);
        vm.deal(address(v), 10 ether);
    }

    function test_pay_recipientThatRejectsEth() public {
        RejectETH rej = new RejectETH();
        KavachVault v = _vaultWith(address(rej), address(fusd));
        uint256 d = ts() + 1 hours;
        bytes32[5] memory f = f3(addr32(address(0)), addr32(address(rej)), bytes32(uint256(1 ether)));
        bytes memory s = signWith(OWNER_SECRET, ownerPk, v.messageFor(A_WITHDRAW, OWNER, d, f));
        vm.expectRevert(KavachVault.TransferFailed.selector);
        v.withdraw(address(0), address(rej), 1 ether, d, ownerPk, s);
        assertEq(address(v).balance, 10 ether, "a failed payout must leave the balance untouched");
        assertEq(v.spentInWindow(address(0)), 0, "and must not count against the daily cap");
    }

    function test_pay_tokenThatReturnsFalse() public {
        FalseToken ft = new FalseToken();
        KavachVault v = _vaultWith(funder, address(ft));
        ft.mint(address(v), 100);
        uint256 d = ts() + 1 hours;
        bytes32[5] memory f = f3(addr32(address(ft)), addr32(funder), bytes32(uint256(1)));
        bytes memory s = signWith(OWNER_SECRET, ownerPk, v.messageFor(A_WITHDRAW, OWNER, d, f));
        vm.expectRevert(KavachVault.TransferFailed.selector);
        v.withdraw(address(ft), funder, 1, d, ownerPk, s);
        assertEq(ft.balanceOf(address(v)), 100);
    }

    function test_deposit_tokenThatReturnsFalse_orHasNoCode() public {
        FalseFromToken bad = new FalseFromToken();
        KavachVault v = _vaultWith(funder, address(bad));
        vm.expectRevert(KavachVault.TransferFailed.selector);
        v.depositToken(address(bad), 1);
        KavachVault v2 = _vaultWith(funder, address(0xBEEF0000)); // no code at the token address
        vm.expectRevert(KavachVault.TransferFailed.selector);
        v2.depositToken(address(0xBEEF0000), 1);
    }

    function test_deposit_tokenWithoutAllowance_reverts() public {
        vm.prank(attacker);
        vm.expectRevert();
        vault.depositToken(address(fusd), 1);
    }
}

contract ColdBranches is Base {
    KavachColdVault cold;
    uint64 release;

    function setUp() public override {
        super.setUp();
        release = uint64(ts() + 1 days);
        address[] memory r = new address[](1);
        r[0] = funder;
        address[] memory t = new address[](1);
        t[0] = address(fusd);
        cold = new KavachColdVault(ownerPk, ownerAcct, r, t, release);
        vm.deal(address(cold), 100 ether);
        vm.warp(release + 1);
    }

    function _s(address asset, address to, uint256 amt, uint256 d) internal view returns (bytes memory) {
        return signWith(OWNER_SECRET, ownerPk, cold.messageFor(asset, to, amt, d));
    }

    function _r() internal view returns (address[] memory r) {
        r = new address[](1);
        r[0] = funder;
    }

    function _t() internal view returns (address[] memory t) {
        t = new address[](1);
        t[0] = address(fusd);
    }

    function _future() internal view returns (uint64) {
        return uint64(ts() + 1 days);
    }

    function test_cold_ctor_rejectsBadKeyAndTime() public {
        vm.warp(1_800_000_000);
        address[] memory r = _r();
        address[] memory t = _t();
        uint64 future = _future();
        vm.expectRevert(KavachColdVault.BadConfig.selector);
        new KavachColdVault(new bytes(10), ownerAcct, r, t, future);
        vm.expectRevert(KavachColdVault.BadConfig.selector);
        new KavachColdVault(ownerPk, address(0), r, t, future);
        vm.expectRevert(KavachColdVault.BadConfig.selector);
        new KavachColdVault(ownerPk, ownerAcct, r, t, uint64(ts())); // release time must be in the future
    }

    function test_cold_ctor_rejectsBadKeyStatus() public {
        vm.warp(1_800_000_000);
        address[] memory r = _r();
        address[] memory t = _t();
        uint64 future = _future();
        vm.expectRevert(KavachColdVault.KeyStatus.selector);
        new KavachColdVault(ownerPk, address(0xAA02), r, t, future);
        MockPQCStatus(PQC_STATUS).set(address(0xAA03), true, 1, attackerPk, true);
        vm.expectRevert(KavachColdVault.KeyStatus.selector);
        new KavachColdVault(ownerPk, address(0xAA03), r, t, future);
    }

    function test_cold_ctor_rejectsBadLists() public {
        vm.warp(1_800_000_000);
        uint64 future = _future();
        address[] memory dup = new address[](2);
        dup[0] = address(fusd);
        dup[1] = address(fusd);
        vm.expectRevert(KavachColdVault.BadConfig.selector);
        new KavachColdVault(ownerPk, ownerAcct, _r(), dup, future);
        address[] memory zeroTok = new address[](1);
        vm.expectRevert(KavachColdVault.BadConfig.selector);
        new KavachColdVault(ownerPk, ownerAcct, _r(), zeroTok, future);
        address[] memory zeroRec = new address[](1);
        vm.expectRevert(KavachColdVault.BadConfig.selector);
        new KavachColdVault(ownerPk, ownerAcct, zeroRec, _t(), future);
    }

    function _good(uint256 d) internal view returns (bytes memory) {
        return _s(address(0), funder, 1 ether, d);
    }

    function test_cold_release_refusesBadTargets() public {
        uint256 d = ts() + 1 hours;
        bytes memory good = _good(d);
        vm.expectRevert(KavachColdVault.NotListed.selector);
        cold.release(address(0xDEAD), funder, 1 ether, d, ownerPk, good);
        vm.expectRevert(KavachColdVault.NotAllowed.selector);
        cold.release(address(0), attacker, 1 ether, d, ownerPk, good);
        vm.expectRevert(KavachColdVault.ZeroAmount.selector);
        cold.release(address(0), funder, 0, d, ownerPk, good);
    }

    function test_cold_release_refusesBadSignatures() public {
        uint256 d = ts() + 1 hours;
        bytes memory good = _good(d);
        vm.expectRevert(KavachColdVault.Expired.selector);
        cold.release(address(0), funder, 1 ether, ts() - 1, ownerPk, good);
        vm.expectRevert(KavachColdVault.BadSignature.selector);
        cold.release(address(0), funder, 1 ether, d, new bytes(5), good);
        vm.expectRevert(KavachColdVault.BadSignature.selector);
        cold.release(address(0), funder, 1 ether, d, ownerPk, new bytes(5));
        vm.expectRevert(KavachColdVault.BadKey.selector);
        cold.release(address(0), funder, 1 ether, d, attackerPk, good);
    }

    function test_cold_release_refusesAlteredAmountAndChangedKeyStatus() public {
        uint256 d = ts() + 1 hours;
        bytes memory good = _good(d);
        vm.expectRevert(KavachColdVault.BadSignature.selector);
        cold.release(address(0), funder, 2 ether, d, ownerPk, good); // amount differs from what was signed
        // the chain says the owner's key is no longer the registered one: refuse even a valid signature
        MockPQCStatus(PQC_STATUS).set(ownerAcct, true, 1, attackerPk, true);
        vm.expectRevert(KavachColdVault.KeyStatus.selector);
        cold.release(address(0), funder, 1 ether, d, ownerPk, good);
        MockPQCStatus(PQC_STATUS).set(ownerAcct, true, 1, ownerPk, false);
        vm.expectRevert(KavachColdVault.KeyStatus.selector);
        cold.release(address(0), funder, 1 ether, d, ownerPk, good);
        assertEq(address(cold).balance, 100 ether);
        assertEq(cold.nonce(), 0);
    }

    function test_cold_payFailures() public {
        RejectETH rej = new RejectETH();
        FalseToken ft = new FalseToken();
        address[] memory r = new address[](1);
        r[0] = address(rej);
        address[] memory t = new address[](1);
        t[0] = address(ft);
        KavachColdVault c2 = new KavachColdVault(ownerPk, ownerAcct, r, t, uint64(ts() + 1 days));
        vm.deal(address(c2), 5 ether);
        ft.mint(address(c2), 50);
        vm.warp(ts() + 1 days + 1);
        uint256 d = ts() + 1 hours;
        bytes memory s1 = signWith(OWNER_SECRET, ownerPk, c2.messageFor(address(0), address(rej), 1 ether, d));
        bytes memory s2 = signWith(OWNER_SECRET, ownerPk, c2.messageFor(address(ft), address(rej), 1, d));
        vm.expectRevert(KavachColdVault.TransferFailed.selector);
        c2.release(address(0), address(rej), 1 ether, d, ownerPk, s1);
        vm.expectRevert(KavachColdVault.TransferFailed.selector);
        c2.release(address(ft), address(rej), 1, d, ownerPk, s2);
        assertEq(address(c2).balance, 5 ether);
        assertEq(c2.nonce(), 0, "a failed payout must not consume the nonce");
    }

    function test_cold_depositRules() public {
        vm.expectRevert(KavachColdVault.NotListed.selector);
        cold.depositToken(address(0), 1);
        vm.expectRevert(KavachColdVault.NotListed.selector);
        cold.depositToken(address(0xDEAD), 1);
        FalseFromToken bad = new FalseFromToken();
        address[] memory r = new address[](1);
        r[0] = funder;
        address[] memory t = new address[](1);
        t[0] = address(bad);
        KavachColdVault c2 = new KavachColdVault(ownerPk, ownerAcct, r, t, uint64(ts() + 1 days));
        vm.expectRevert(KavachColdVault.TransferFailed.selector);
        c2.depositToken(address(bad), 1);
    }

    function test_cold_unknownCallsAndEthDeposit() public {
        (bool ok,) = address(cold).call(abi.encodeWithSignature("nonexistent()"));
        assertFalse(ok);
        (ok,) = address(cold).call{value: 1 ether}("");
        assertTrue(ok);
        assertEq(address(cold).balance, 101 ether);
    }
}
