// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base, MockToken} from "./helpers/Base.t.sol";
import {KavachVault} from "../src/KavachVault.sol";
import {MockPQCStatus, MockPQCVerify} from "./mocks/MockPQC.sol";

contract KavachVaultUnit is Base {
    // ---------------------------------------------------------------- constructor
    function _deploy(bytes memory pubkey, address acct, bytes32 gHash, uint64 delay) internal returns (KavachVault) {
        address[] memory rec = new address[](1);
        rec[0] = funder;
        address[] memory toks = new address[](1);
        toks[0] = address(fusd);
        KavachVault.Limits[] memory lim = new KavachVault.Limits[](2);
        lim[0] = KavachVault.Limits(25 ether, 100 ether);
        lim[1] = KavachVault.Limits(250e6, 1000e6);
        return new KavachVault(pubkey, acct, gHash, rec, toks, lim, delay);
    }

    function test_constructor_ok() public view {
        assertEq(vault.OWNER_ACCOUNT(), ownerAcct);
        assertEq(vault.OWNER_KEY_HASH(), keccak256(ownerPk));
        assertEq(vault.GUARDIAN_KEY_HASH(), keccak256(guardianPk));
        assertTrue(vault.allowedRecipient(funder));
        assertTrue(vault.listedAsset(address(0)));
        assertTrue(vault.listedAsset(address(fusd)));
        assertEq(vault.timelockDelay(), 6 hours);
    }

    function test_constructor_revertsWhenChainKeyDiffers() public {
        MockPQCStatus(PQC_STATUS).set(ownerAcct, true, 1, attackerPk, true);
        vm.expectRevert(KavachVault.KeyStatus.selector);
        _deploy(ownerPk, ownerAcct, keccak256(guardianPk), 6 hours);
    }

    function test_constructor_revertsWithoutProofOfPossession() public {
        MockPQCStatus(PQC_STATUS).set(ownerAcct, true, 1, ownerPk, false);
        vm.expectRevert(KavachVault.KeyStatus.selector);
        _deploy(ownerPk, ownerAcct, keccak256(guardianPk), 6 hours);
    }

    function test_constructor_revertsWhenUnregisteredOrWrongAlgo() public {
        MockPQCStatus(PQC_STATUS).set(ownerAcct, false, 0, "", false);
        vm.expectRevert(KavachVault.KeyStatus.selector);
        _deploy(ownerPk, ownerAcct, keccak256(guardianPk), 6 hours);
        MockPQCStatus(PQC_STATUS).set(ownerAcct, true, 2, ownerPk, true);
        vm.expectRevert(KavachVault.KeyStatus.selector);
        _deploy(ownerPk, ownerAcct, keccak256(guardianPk), 6 hours);
    }

    function test_constructor_badConfig() public {
        vm.expectRevert(KavachVault.BadConfig.selector);
        _deploy(new bytes(10), ownerAcct, keccak256(guardianPk), 6 hours); // wrong key length
        vm.expectRevert(KavachVault.BadConfig.selector);
        _deploy(ownerPk, ownerAcct, keccak256(ownerPk), 6 hours); // guardian == owner
        vm.expectRevert(KavachVault.BadConfig.selector);
        _deploy(ownerPk, ownerAcct, bytes32(0), 6 hours);
        vm.expectRevert(KavachVault.BadConfig.selector);
        _deploy(ownerPk, ownerAcct, keccak256(guardianPk), 59 minutes); // delay too short
        vm.expectRevert(KavachVault.BadConfig.selector);
        _deploy(ownerPk, ownerAcct, keccak256(guardianPk), 8 days); // delay too long
        vm.expectRevert(KavachVault.BadConfig.selector);
        _deploy(ownerPk, address(0), keccak256(guardianPk), 6 hours);
    }

    // ---------------------------------------------------------------- deposits
    function test_depositQOR_viaReceive() public {
        uint256 b = address(vault).balance;
        (bool ok,) = address(vault).call{value: 1 ether}("");
        assertTrue(ok);
        assertEq(address(vault).balance, b + 1 ether);
    }

    function test_fallback_reverts() public {
        (bool ok,) = address(vault).call{value: 1 ether}(hex"deadbeef");
        assertFalse(ok);
        (ok,) = address(vault).call(hex"12345678");
        assertFalse(ok);
    }

    function test_depositToken_listedOnly() public {
        fusd.mint(address(this), 1e6);
        uint256 b = fusd.balanceOf(address(vault));
        vault.depositToken(address(fusd), 1e6);
        assertEq(fusd.balanceOf(address(vault)), b + 1e6);
        MockToken other = new MockToken();
        vm.expectRevert(KavachVault.NotListed.selector);
        vault.depositToken(address(other), 1);
        vm.expectRevert(KavachVault.NotListed.selector);
        vault.depositToken(address(0), 1);
    }

    // ---------------------------------------------------------------- withdraw
    function test_withdraw_QOR_andToken() public {
        uint256 b = funder.balance;
        doWithdraw(address(0), funder, 10 ether);
        assertEq(funder.balance, b + 10 ether);
        doWithdraw(address(fusd), funder, 100e6);
        assertEq(fusd.balanceOf(funder), 100e6);
        assertEq(vault.nonces(OWNER), 2);
        assertEq(vault.spentInWindow(address(0)), 10 ether);
    }

    function test_withdraw_recipientMustBeAllowlisted() public {
        uint256 d = ts() + 1 hours;
        bytes memory s = ownerSig(A_WITHDRAW, d, f3(addr32(address(0)), addr32(attacker), bytes32(uint256(1 ether))));
        vm.expectRevert(KavachVault.NotAllowed.selector);
        vault.withdraw(address(0), attacker, 1 ether, d, ownerPk, s);
    }

    function test_withdraw_perTxCap() public {
        uint256 d = ts() + 1 hours;
        bytes memory s = ownerSig(A_WITHDRAW, d, f3(addr32(address(0)), addr32(funder), bytes32(uint256(25 ether + 1))));
        vm.expectRevert(KavachVault.OverPerTx.selector);
        vault.withdraw(address(0), funder, 25 ether + 1, d, ownerPk, s);
        doWithdraw(address(0), funder, 25 ether); // exactly the cap is fine
    }

    function test_withdraw_dailyCap_rolling() public {
        for (uint256 i = 0; i < 4; i++) doWithdraw(address(0), funder, 25 ether); // 100 = the cap
        uint256 d = ts() + 1 hours;
        bytes memory s = ownerSig(A_WITHDRAW, d, f3(addr32(address(0)), addr32(funder), bytes32(uint256(1))));
        vm.expectRevert(KavachVault.OverDaily.selector);
        vault.withdraw(address(0), funder, 1, d, ownerPk, s);
        vm.warp(ts() + 24 hours); // still inside the 25-bucket window
        d = ts() + 1 hours;
        s = ownerSig(A_WITHDRAW, d, f3(addr32(address(0)), addr32(funder), bytes32(uint256(1))));
        vm.expectRevert(KavachVault.OverDaily.selector);
        vault.withdraw(address(0), funder, 1, d, ownerPk, s);
        vm.warp(ts() + 1 hours + 1); // now past 25 hours
        assertEq(vault.spentInWindow(address(0)), 0);
        doWithdraw(address(0), funder, 25 ether);
    }

    function test_withdraw_anyTwentyFourHourIntervalWithinCap() public {
        // Spend the whole cap late in hour 0, wait until just after 24 h, try again: must still be blocked.
        vm.warp(1_800_000_000 - (1_800_000_000 % 3600) + 3599); // last second of an hour
        for (uint256 i = 0; i < 4; i++) doWithdraw(address(0), funder, 25 ether);
        vm.warp(ts() + 24 hours); // the same wall-clock second a day later
        uint256 d = ts() + 1 hours;
        bytes memory s = ownerSig(A_WITHDRAW, d, f3(addr32(address(0)), addr32(funder), bytes32(uint256(1))));
        vm.expectRevert(KavachVault.OverDaily.selector);
        vault.withdraw(address(0), funder, 1, d, ownerPk, s);
    }

    function test_withdraw_zeroAndUnlisted() public {
        uint256 d = ts() + 1 hours;
        bytes memory s = ownerSig(A_WITHDRAW, d, f3(addr32(address(0)), addr32(funder), 0));
        vm.expectRevert(KavachVault.ZeroAmount.selector);
        vault.withdraw(address(0), funder, 0, d, ownerPk, s);
        address junk = address(0x1234);
        s = ownerSig(A_WITHDRAW, d, f3(addr32(junk), addr32(funder), bytes32(uint256(1))));
        vm.expectRevert(KavachVault.NotListed.selector);
        vault.withdraw(junk, funder, 1, d, ownerPk, s);
    }

    function test_nonce_increments_andOldSignatureDies() public {
        uint256 d = ts() + 1 hours;
        bytes memory s = ownerSig(A_WITHDRAW, d, f3(addr32(address(0)), addr32(funder), bytes32(uint256(1 ether))));
        vault.withdraw(address(0), funder, 1 ether, d, ownerPk, s);
        vm.expectRevert(KavachVault.BadSignature.selector); // same bytes again: nonce moved
        vault.withdraw(address(0), funder, 1 ether, d, ownerPk, s);
    }

    function test_deadline() public {
        uint256 d = ts() + 10;
        bytes memory s = ownerSig(A_WITHDRAW, d, f3(addr32(address(0)), addr32(funder), bytes32(uint256(1 ether))));
        vm.warp(ts() + 11);
        vm.expectRevert(KavachVault.Expired.selector);
        vault.withdraw(address(0), funder, 1 ether, d, ownerPk, s);
    }

    // ---------------------------------------------------------------- queue + timelock
    function _queue(uint256 action, bytes32[5] memory f) internal returns (bytes32 id) {
        uint256 d = ts() + 1 hours;
        id = vault.queueAction(action, f, d, ownerPk, ownerSig(action, d, f));
    }

    function test_queuedWithdraw_waitsForDelay() public {
        bytes32 id = _queue(A_QWITHDRAW, f3(addr32(address(0)), addr32(funder), bytes32(uint256(200 ether))));
        vm.expectRevert(KavachVault.NotReady.selector);
        vault.execute(id);
        vm.warp(ts() + 6 hours);
        uint256 b = funder.balance;
        vm.prank(attacker); // anyone may trigger it; the destination was signed
        vault.execute(id);
        assertEq(funder.balance, b + 200 ether);
        vm.expectRevert(KavachVault.AlreadyDone.selector);
        vault.execute(id);
    }

    function test_cancel_byGuardian_andByOwner() public {
        bytes32 id = _queue(A_QWITHDRAW, f3(addr32(address(0)), addr32(funder), bytes32(uint256(5 ether))));
        uint256 d = ts() + 1 hours;
        vault.cancel(id, GUARDIAN, d, guardianPk, guardianSig(A_CANCEL, d, f3(id, 0, 0)));
        vm.warp(ts() + 6 hours);
        vm.expectRevert(KavachVault.AlreadyDone.selector);
        vault.execute(id);
        bytes32 id2 = _queue(A_QWITHDRAW, f3(addr32(address(0)), addr32(funder), bytes32(uint256(5 ether))));
        d = ts() + 1 hours;
        vault.cancel(id2, OWNER, d, ownerPk, ownerSig(A_CANCEL, d, f3(id2, 0, 0)));
        vm.expectRevert(KavachVault.AlreadyDone.selector);
        vault.execute(id2);
    }

    function test_queue_unknownActionRejected() public {
        uint256 d = ts() + 1 hours;
        bytes32[5] memory f = f3(0, 0, 0);
        bytes memory s = ownerSig(A_WITHDRAW, d, f); // a withdraw signature cannot be used as a queue entry
        vm.expectRevert(KavachVault.UnknownAction.selector);
        vault.queueAction(A_WITHDRAW, f, d, ownerPk, s);
        vm.expectRevert(KavachVault.UnknownAction.selector);
        vault.execute(bytes32(uint256(123)));
    }

    function test_queued_limitsRecipientDelay() public {
        // limits
        bytes32 id = _queue(A_QLIMITS, f3(addr32(address(0)), bytes32(uint256(10 ether)), bytes32(uint256(30 ether))));
        vm.warp(ts() + 6 hours);
        vault.execute(id);
        (uint128 p, uint128 dl) = vault.limits(address(0));
        assertEq(p, 10 ether);
        assertEq(dl, 30 ether);
        // recipient
        address newR = address(0xABCD);
        id = _queue(A_QRECIP, f3(addr32(newR), bytes32(uint256(1)), 0));
        vm.warp(ts() + 6 hours);
        vault.execute(id);
        assertTrue(vault.allowedRecipient(newR));
        // delay (bounded)
        id = _queue(A_QDELAY, f3(bytes32(uint256(2 hours)), 0, 0));
        vm.warp(ts() + 6 hours);
        vault.execute(id);
        assertEq(vault.timelockDelay(), 2 hours);
        id = _queue(A_QDELAY, f3(bytes32(uint256(30 minutes)), 0, 0));
        vm.warp(ts() + 2 hours);
        vm.expectRevert(KavachVault.BadConfig.selector);
        vault.execute(id);
    }

    function test_queued_limitsMustStaySane() public {
        bytes32 id = _queue(A_QLIMITS, f3(addr32(address(0)), bytes32(uint256(50 ether)), bytes32(uint256(10 ether)))); // daily < perTx
        vm.warp(ts() + 6 hours);
        vm.expectRevert(KavachVault.BadConfig.selector);
        vault.execute(id);
    }

    // ---------------------------------------------------------------- freeze / unfreeze / heartbeat / roles
    function test_freeze_byGuardian_blocksMoneyButNotHeartbeat() public {
        uint256 d = ts() + 1 hours;
        vault.freeze(GUARDIAN, d, guardianPk, guardianSig(A_FREEZE, d, f3(0, 0, 0)));
        assertTrue(vault.frozen());
        d = ts() + 1 hours;
        bytes memory s = ownerSig(A_WITHDRAW, d, f3(addr32(address(0)), addr32(funder), bytes32(uint256(1 ether))));
        vm.expectRevert(KavachVault.Frozen.selector);
        vault.withdraw(address(0), funder, 1 ether, d, ownerPk, s);
        bytes32[5] memory z = f3(0, 0, 0);
        bytes memory qs = ownerSig(A_QWITHDRAW, d, z); // compute before expectRevert: it is itself an external call
        vm.expectRevert(KavachVault.Frozen.selector);
        vault.queueAction(A_QWITHDRAW, z, d, ownerPk, qs);
        // proof of life still works while frozen
        vault.heartbeat(d, ownerPk, ownerSig(A_HEARTBEAT, d, f3(0, 0, 0)));
    }

    function test_unfreeze_needsBothKeys() public {
        uint256 d = ts() + 1 hours;
        vault.freeze(OWNER, d, ownerPk, ownerSig(A_FREEZE, d, f3(0, 0, 0)));
        d = ts() + 1 hours;
        bytes memory os = ownerSig(A_UNFREEZE, d, f3(0, 0, 0));
        bytes memory gs = guardianSig(A_UNFREEZE, d, f3(0, 0, 0));
        // owner twice (no guardian)
        vm.expectRevert(KavachVault.BadKey.selector);
        vault.unfreeze(d, ownerPk, os, ownerPk, os);
        // guardian twice (no owner)
        vm.expectRevert(KavachVault.BadKey.selector);
        vault.unfreeze(d, guardianPk, gs, guardianPk, gs);
        // both, in the wrong slots
        vm.expectRevert(KavachVault.BadKey.selector);
        vault.unfreeze(d, guardianPk, gs, ownerPk, os);
        assertTrue(vault.frozen());
        vault.unfreeze(d, ownerPk, os, guardianPk, gs);
        assertFalse(vault.frozen());
        doWithdraw(address(0), funder, 1 ether);
    }

    function test_guardianCannotMoveFunds() public {
        uint256 d = ts() + 1 hours;
        // A guardian signature over a withdraw message is useless: withdraw() only accepts the owner key.
        bytes memory gs = guardianSig(A_WITHDRAW, d, f3(addr32(address(0)), addr32(funder), bytes32(uint256(1 ether))));
        vm.expectRevert(KavachVault.BadKey.selector);
        vault.withdraw(address(0), funder, 1 ether, d, guardianPk, gs);
        bytes32[5] memory z = f3(0, 0, 0);
        vm.expectRevert(KavachVault.BadKey.selector);
        vault.queueAction(A_QWITHDRAW, z, d, guardianPk, gs);
    }

    function test_heartbeat_emitsAndConsumesNonce() public {
        uint256 d = ts() + 1 hours;
        uint256 n = vault.nonces(OWNER);
        vm.expectEmit(false, false, false, true);
        emit KavachVault.Heartbeat(n, block.number);
        vault.heartbeat(d, ownerPk, ownerSig(A_HEARTBEAT, d, f3(0, 0, 0)));
        assertEq(vault.nonces(OWNER), n + 1);
    }

    function test_badRole() public {
        uint256 d = ts() + 1 hours;
        vm.expectRevert(KavachVault.BadRole.selector);
        vault.freeze(0, d, ownerPk, new bytes(4627));
        vm.expectRevert(KavachVault.BadRole.selector);
        vault.freeze(3, d, ownerPk, new bytes(4627));
    }
}

contract KavachVaultLiveness is Base {
    /// I7: with honest keys the owner can always get everything out: instant slices within the daily cap, large amounts through the queue.
    function test_I7_liveness_drainEverythingWithinLimitsAndQueue() public {
        uint256 start = address(vault).balance; // 500 QOR
        uint256 got = funder.balance;
        for (uint256 day = 0; day < 3; day++) {
            for (uint256 i = 0; i < 4; i++) doWithdraw(address(0), funder, 25 ether);
            vm.warp(ts() + 25 hours);
        }
        assertEq(funder.balance - got, 300 ether);
        // the rest, 200 QOR, through the timelock queue
        uint256 d = ts() + 1 hours;
        bytes32[5] memory f = f3(addr32(address(0)), addr32(funder), bytes32(uint256(address(vault).balance)));
        bytes32 id = vault.queueAction(A_QWITHDRAW, f, d, ownerPk, ownerSig(A_QWITHDRAW, d, f));
        vm.warp(ts() + 6 hours);
        vault.execute(id);
        assertEq(address(vault).balance, 0);
        assertEq(funder.balance - got, start);
    }

    function test_I7_liveness_freezeThenUnfreezeThenWithdraw() public {
        uint256 d = ts() + 1 hours;
        vault.freeze(GUARDIAN, d, guardianPk, guardianSig(A_FREEZE, d, f3(0, 0, 0)));
        d = ts() + 1 hours;
        vault.unfreeze(d, ownerPk, ownerSig(A_UNFREEZE, d, f3(0, 0, 0)), guardianPk, guardianSig(A_UNFREEZE, d, f3(0, 0, 0)));
        uint256 b = funder.balance;
        doWithdraw(address(0), funder, 25 ether);
        assertEq(funder.balance, b + 25 ether);
    }

    function test_I7_liveness_tokenAndQORBothWithdrawable() public {
        doWithdraw(address(fusd), funder, 250e6);
        doWithdraw(address(0), funder, 25 ether);
        assertEq(fusd.balanceOf(funder), 250e6);
    }
}
