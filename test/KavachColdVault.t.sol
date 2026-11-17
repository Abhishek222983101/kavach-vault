// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base, MockToken} from "./helpers/Base.t.sol";
import {KavachColdVault} from "../src/KavachColdVault.sol";
import {MockPQCVerify, MockPQCStatus, EmptyReturn} from "./mocks/MockPQC.sol";

contract ColdVaultTest is Base {
    KavachColdVault cold;
    uint64 release;

    function setUp() public override {
        super.setUp();
        release = uint64(ts() + 2 days);
        address[] memory rec = new address[](1);
        rec[0] = funder;
        address[] memory toks = new address[](1);
        toks[0] = address(fusd);
        cold = new KavachColdVault(ownerPk, ownerAcct, rec, toks, release);
        vm.deal(address(this), 800 ether);
        (bool ok,) = address(cold).call{value: 800 ether}("");
        require(ok);
        fusd.mint(address(this), 1_000e6);
        fusd.approve(address(cold), type(uint256).max);
        cold.depositToken(address(fusd), 1_000e6);
    }

    function _sig(address asset, address to, uint256 amt, uint256 d) internal view returns (bytes memory) {
        return signWith(OWNER_SECRET, ownerPk, cold.messageFor(asset, to, amt, d));
    }

    function test_T_cold_lockedBeforeRelease_withValidSignature() public {
        uint256 d = ts() + 30 days;
        bytes memory s = _sig(address(0), funder, 10 ether, d);
        vm.expectRevert(KavachColdVault.Locked.selector);
        cold.release(address(0), funder, 10 ether, d, ownerPk, s);
        vm.warp(release - 1);
        vm.expectRevert(KavachColdVault.Locked.selector);
        cold.release(address(0), funder, 10 ether, d, ownerPk, s);
        assertEq(address(cold).balance, 800 ether);
    }

    function test_T_cold_lockedBeforeRelease_evenWithEveryOtherCheckWrong() public {
        // Locked() must come first: junk everything, still Locked, so no other branch is reachable early
        vm.expectRevert(KavachColdVault.Locked.selector);
        cold.release(address(0x1), attacker, 0, 0, "", "");
        vm.etch(PQC_VERIFY, "");
        vm.etch(PQC_STATUS, "");
        vm.expectRevert(KavachColdVault.Locked.selector);
        cold.release(address(0), funder, 1, ts() + 1, ownerPk, new bytes(4627));
    }

    function test_cold_releasesAfterTime_withOwnerSignatureOnly() public {
        vm.warp(release);
        uint256 d = ts() + 1 hours;
        bytes memory s = _sig(address(0), funder, 300 ether, d);
        uint256 b = funder.balance;
        vm.prank(attacker); // anyone may submit
        cold.release(address(0), funder, 300 ether, d, ownerPk, s);
        assertEq(funder.balance, b + 300 ether);
        assertEq(cold.nonce(), 1);
        d = ts() + 1 hours;
        s = _sig(address(fusd), funder, 400e6, d);
        cold.release(address(fusd), funder, 400e6, d, ownerPk, s);
        assertEq(fusd.balanceOf(funder), 400e6);
    }

    function test_cold_afterRelease_stillNoDrainWithoutSignature() public {
        vm.warp(release + 365 days);
        uint256 d = ts() + 1 hours;
        bytes[4] memory bad;
        bad[0] = new bytes(4627);
        bad[1] = new bytes(10);
        bad[2] = _sig(address(0), funder, 1 ether, d); // right signature, will be presented with a different amount
        bad[3] = signWith(ATTACKER_SECRET, attackerPk, cold.messageFor(address(0), funder, 1 ether, d));
        vm.expectRevert(KavachColdVault.BadSignature.selector);
        cold.release(address(0), funder, 1 ether, d, ownerPk, bad[0]);
        vm.expectRevert(KavachColdVault.BadSignature.selector);
        cold.release(address(0), funder, 1 ether, d, ownerPk, bad[1]);
        vm.expectRevert(KavachColdVault.BadSignature.selector);
        cold.release(address(0), funder, 2 ether, d, ownerPk, bad[2]);
        vm.expectRevert(KavachColdVault.BadKey.selector);
        cold.release(address(0), funder, 1 ether, d, attackerPk, bad[3]);
        vm.expectRevert(KavachColdVault.NotAllowed.selector);
        cold.release(address(0), attacker, 1 ether, d, ownerPk, bad[2]);
        assertEq(address(cold).balance, 800 ether);
    }

    function test_cold_replayAndCrossVaultAndDomain() public {
        vm.warp(release);
        uint256 d = ts() + 1 hours;
        bytes memory s = _sig(address(0), funder, 1 ether, d);
        cold.release(address(0), funder, 1 ether, d, ownerPk, s);
        vm.expectRevert(KavachColdVault.BadSignature.selector); // nonce moved
        cold.release(address(0), funder, 1 ether, d, ownerPk, s);
        // a HOT vault signature (different domain) can never release cold funds
        bytes32[5] memory f = f3(addr32(address(0)), addr32(funder), bytes32(uint256(1 ether)));
        bytes memory hot = ownerSig(A_WITHDRAW, d, f);
        vm.expectRevert(KavachColdVault.BadSignature.selector);
        cold.release(address(0), funder, 1 ether, d, ownerPk, hot);
    }

    function test_cold_failsClosedWhenPrecompilesMisbehave() public {
        vm.warp(release);
        uint256 d = ts() + 1 hours;
        bytes memory s = _sig(address(0), funder, 1 ether, d);
        vm.etch(PQC_VERIFY, address(new EmptyReturn()).code);
        vm.expectRevert();
        cold.release(address(0), funder, 1 ether, d, ownerPk, s);
        vm.etch(PQC_VERIFY, address(new MockPQCVerify()).code);
        MockPQCVerify(PQC_VERIFY).setSecret(ownerPk, OWNER_SECRET);
        MockPQCStatus(PQC_STATUS).set(ownerAcct, true, 1, attackerPk, true);
        vm.expectRevert(KavachColdVault.KeyStatus.selector);
        cold.release(address(0), funder, 1 ether, d, ownerPk, s);
    }

    function test_cold_constructorChecks() public {
        address[] memory rec = new address[](1);
        rec[0] = funder;
        address[] memory toks = new address[](0);
        vm.expectRevert(KavachColdVault.BadConfig.selector);
        new KavachColdVault(ownerPk, ownerAcct, rec, toks, uint64(ts())); // release not in the future
        MockPQCStatus(PQC_STATUS).set(ownerAcct, true, 1, ownerPk, false);
        vm.expectRevert(KavachColdVault.KeyStatus.selector);
        new KavachColdVault(ownerPk, ownerAcct, rec, toks, uint64(ts() + 1 days));
    }

    function test_cold_noOtherSurface() public {
        for (uint256 i = 0; i < 6; i++) {
            string[6] memory sigs = ["withdraw(address,address,uint256)", "setOwner(address)", "queueAction(uint256)", "freeze()", "approve(address,uint256)", "upgradeTo(address)"];
            (bool ok,) = address(cold).call(abi.encodeWithSignature(sigs[i], address(1), address(2), 3));
            assertFalse(ok);
        }
        (bool ok2,) = address(cold).call{value: 1}(hex"01020304");
        assertFalse(ok2);
    }

    function testFuzz_cold_neverMovesBeforeRelease(uint64 when, bytes calldata sig, address caller, uint256 amt) public {
        when = uint64(bound(when, ts(), release - 1));
        vm.warp(when);
        uint256 b = address(cold).balance;
        vm.prank(caller);
        try cold.release(address(0), funder, bound(amt, 1, 800 ether), ts() + 1 days, ownerPk, sig) {
            revert("released before time");
        } catch {}
        assertEq(address(cold).balance, b);
    }
}
