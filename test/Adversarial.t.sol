// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base, MockToken} from "./helpers/Base.t.sol";
import {KavachVault} from "../src/KavachVault.sol";
import {MockPQCStatus, MockPQCVerify, EmptyReturn} from "./mocks/MockPQC.sol";

/// Re-enters the vault from receive(). If reentrancy guards fail, this drains more than one signed request.
contract Reenterer {
    KavachVault public v;
    bytes public pk;
    bytes public sig;
    uint256 public deadline;
    bytes32 public qid;
    uint256 public attempts;
    bool public reentered;
    uint8 public mode; // 0 = withdraw, 1 = execute

    function arm(KavachVault v_, bytes memory pk_, bytes memory sig_, uint256 d, bytes32 id, uint8 m) external {
        v = v_;
        pk = pk_;
        sig = sig_;
        deadline = d;
        qid = id;
        mode = m;
    }

    receive() external payable {
        attempts++;
        if (attempts > 3) return;
        if (mode == 0) {
            try v.withdraw(address(0), address(this), 1 ether, deadline, pk, sig) {
                reentered = true;
            } catch {}
        } else {
            try v.execute(qid) {
                reentered = true;
            } catch {}
        }
    }
}

contract ForceSend {
    constructor(address payable target) payable {
        selfdestruct(target);
    }
}

contract LyingToken {
    function balanceOf(address) external pure returns (uint256) {
        return 0;
    }

    function transferFrom(address, address, uint256) external pure returns (bool) {
        return false;
    }

    function transfer(address, uint256) external pure returns (bool) {
        return false;
    }
}

contract Adversarial is Base {
    function _vaultBal() internal view returns (uint256) {
        return address(vault).balance;
    }

    // ------------------------------------------------------------ A5: drain calls without the PQ key
    function test_T_A5_drainWithoutSig() public {
        uint256 b = _vaultBal();
        uint256 tb = fusd.balanceOf(address(vault));
        vm.startPrank(attacker);
        uint256 d = ts() + 1 days;
        bytes memory junk = new bytes(4627);
        vm.expectRevert(KavachVault.NotAllowed.selector);
        vault.withdraw(address(0), attacker, 1 ether, d, ownerPk, junk); // attacker is not an allowed recipient
        vm.expectRevert(KavachVault.BadSignature.selector);
        vault.withdraw(address(0), funder, 1 ether, d, ownerPk, junk); // allowed recipient but no signature
        vm.expectRevert(KavachVault.BadSignature.selector);
        vault.withdraw(address(fusd), funder, 1e6, d, ownerPk, junk);
        vm.stopPrank();
        assertEq(_vaultBal(), b);
        assertEq(fusd.balanceOf(address(vault)), tb);
        assertEq(attacker.balance, 0);
    }

    // ------------------------------------------------------------ B10: replay
    function test_T_B10_replayNonce() public {
        uint256 d = ts() + 1 hours;
        bytes memory s = ownerSig(A_WITHDRAW, d, f3(addr32(address(0)), addr32(funder), bytes32(uint256(1 ether))));
        vault.withdraw(address(0), funder, 1 ether, d, ownerPk, s);
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(attacker);
            vm.expectRevert(KavachVault.BadSignature.selector);
            vault.withdraw(address(0), funder, 1 ether, d, ownerPk, s);
        }
    }

    function test_T_B10_replayAcrossVaults() public {
        // a second vault with identical configuration must not accept the first vault's signature
        address[] memory rec = new address[](1);
        rec[0] = funder;
        address[] memory toks = new address[](0);
        KavachVault.Limits[] memory lim = new KavachVault.Limits[](1);
        lim[0] = KavachVault.Limits(25 ether, 100 ether);
        KavachVault v2 = new KavachVault(ownerPk, ownerAcct, keccak256(guardianPk), rec, toks, lim, 6 hours);
        (bool ok,) = address(v2).call{value: 50 ether}("");
        assertTrue(ok);
        uint256 d = ts() + 1 hours;
        bytes memory s = ownerSig(A_WITHDRAW, d, f3(addr32(address(0)), addr32(funder), bytes32(uint256(1 ether))));
        vm.expectRevert(KavachVault.BadSignature.selector);
        v2.withdraw(address(0), funder, 1 ether, d, ownerPk, s);
    }

    function test_T_B10_replayAcrossChains() public {
        uint256 d = ts() + 1 hours;
        bytes memory s = ownerSig(A_WITHDRAW, d, f3(addr32(address(0)), addr32(funder), bytes32(uint256(1 ether))));
        vm.chainId(1);
        vm.expectRevert(KavachVault.BadSignature.selector);
        vault.withdraw(address(0), funder, 1 ether, d, ownerPk, s);
        vm.chainId(9800);
        vault.withdraw(address(0), funder, 1 ether, d, ownerPk, s); // the same signature is fine on the right chain
    }

    function test_T_B10_expired() public {
        uint256 d = ts() + 100;
        bytes memory s = ownerSig(A_WITHDRAW, d, f3(addr32(address(0)), addr32(funder), bytes32(uint256(1 ether))));
        vm.warp(ts() + 101);
        vm.expectRevert(KavachVault.Expired.selector);
        vault.withdraw(address(0), funder, 1 ether, d, ownerPk, s);
    }

    // ------------------------------------------------------------ B11: signatures made for something else
    function test_T_B11_crossFormatSig() public {
        uint256 d = ts() + 1 hours;
        bytes32[5] memory f = f3(addr32(address(0)), addr32(funder), bytes32(uint256(1 ether)));
        // (a) the owner key signs a same-length message that starts like an SDK format ('q' = 0x71, hybrid v2) instead of 0xFF
        bytes memory real = msgFor(A_WITHDRAW, OWNER, d, f);
        bytes memory fake = real;
        fake[0] = 0x71;
        bytes memory s = signWith(OWNER_SECRET, ownerPk, fake);
        vm.expectRevert(KavachVault.BadSignature.selector);
        vault.withdraw(address(0), funder, 1 ether, d, ownerPk, s);
        // (b) a signature for a different amount
        s = ownerSig(A_WITHDRAW, d, f3(addr32(address(0)), addr32(funder), bytes32(uint256(2 ether))));
        vm.expectRevert(KavachVault.BadSignature.selector);
        vault.withdraw(address(0), funder, 1 ether, d, ownerPk, s);
        // (c) a signature for a different action (heartbeat) reused as a withdraw
        s = ownerSig(A_HEARTBEAT, d, f);
        vm.expectRevert(KavachVault.BadSignature.selector);
        vault.withdraw(address(0), funder, 1 ether, d, ownerPk, s);
        // (d) the owner role message presented with the guardian role (role is bound inside the message)
        s = signWith(GUARD_SECRET, guardianPk, msgFor(A_FREEZE, OWNER, d, f3(0, 0, 0)));
        vm.expectRevert(KavachVault.BadSignature.selector);
        vault.freeze(GUARDIAN, d, guardianPk, s);
        // (e) a different deadline than the one signed
        s = ownerSig(A_WITHDRAW, d, f);
        vm.expectRevert(KavachVault.BadSignature.selector);
        vault.withdraw(address(0), funder, 1 ether, d + 1, ownerPk, s);
    }

    // ------------------------------------------------------------ B12: junk signatures and keys
    function test_T_B12_junkSig() public {
        uint256 d = ts() + 1 hours;
        uint256 n = vault.nonces(OWNER);
        bytes[7] memory junk;
        junk[0] = new bytes(0);
        junk[1] = new bytes(4626);
        junk[2] = new bytes(4628);
        junk[3] = new bytes(4627); // all zero
        junk[4] = abi.encodePacked(keccak256("a"), new bytes(4595)); // random-looking, right length
        junk[5] = new bytes(1);
        bytes memory valid = ownerSig(A_WITHDRAW, d, f3(addr32(address(0)), addr32(funder), bytes32(uint256(1 ether))));
        junk[6] = abi.encodePacked(valid, hex"00"); // valid signature plus a trailing byte
        for (uint256 i = 0; i < 7; i++) {
            vm.expectRevert(KavachVault.BadSignature.selector);
            vault.withdraw(address(0), funder, 1 ether, d, ownerPk, junk[i]);
        }
        assertEq(vault.nonces(OWNER), n);
        // wrong-length public keys
        vm.expectRevert(KavachVault.BadSignature.selector);
        vault.withdraw(address(0), funder, 1 ether, d, new bytes(2591), valid);
        vm.expectRevert(KavachVault.BadSignature.selector);
        vault.withdraw(address(0), funder, 1 ether, d, new bytes(2593), valid);
        vm.expectRevert(KavachVault.BadSignature.selector);
        vault.withdraw(address(0), funder, 1 ether, d, "", valid);
    }

    function testFuzz_T_B12_randomSigNeverVerifies(bytes calldata sig, address caller, uint256 amt) public {
        vm.assume(sig.length != 4627 || sig[0] != 0xAA); // arbitrary input; success would need a 2^-256 hash collision
        uint256 b = _vaultBal();
        vm.prank(caller);
        try vault.withdraw(address(0), funder, bound(amt, 1, 25 ether), ts() + 1 hours, ownerPk, sig) {
            revert("random signature accepted");
        } catch {}
        assertEq(_vaultBal(), b);
    }

    // ------------------------------------------------------------ B13: the attacker's own valid key
    function test_T_B13_attackerKey() public {
        uint256 d = ts() + 1 hours;
        bytes32[5] memory f = f3(addr32(address(0)), addr32(funder), bytes32(uint256(1 ether)));
        // a perfectly valid signature by the attacker's key, over the correct message
        bytes memory s = signWith(ATTACKER_SECRET, attackerPk, msgFor(A_WITHDRAW, OWNER, d, f));
        vm.expectRevert(KavachVault.BadKey.selector); // pinned owner key hash
        vault.withdraw(address(0), funder, 1 ether, d, attackerPk, s);
        // the attacker's key claiming to be the guardian
        s = signWith(ATTACKER_SECRET, attackerPk, msgFor(A_FREEZE, GUARDIAN, d, f3(0, 0, 0)));
        vm.expectRevert(KavachVault.BadKey.selector);
        vault.freeze(GUARDIAN, d, attackerPk, s);
        // owner public key, attacker's signature
        s = signWith(ATTACKER_SECRET, ownerPk, msgFor(A_WITHDRAW, OWNER, d, f));
        vm.expectRevert(KavachVault.BadSignature.selector);
        vault.withdraw(address(0), funder, 1 ether, d, ownerPk, s);
    }

    function test_T_B13_chainKeyChangedOwnerLocksButGuardianStillFreezes() public {
        // if the chain ever reports a different key for the owner account, owner actions fail closed...
        MockPQCStatus(PQC_STATUS).set(ownerAcct, true, 1, attackerPk, true);
        uint256 d = ts() + 1 hours;
        bytes memory s = ownerSig(A_WITHDRAW, d, f3(addr32(address(0)), addr32(funder), bytes32(uint256(1 ether))));
        vm.expectRevert(KavachVault.KeyStatus.selector);
        vault.withdraw(address(0), funder, 1 ether, d, ownerPk, s);
        // ...but the guardian can still freeze
        vault.freeze(GUARDIAN, d, guardianPk, guardianSig(A_FREEZE, d, f3(0, 0, 0)));
        assertTrue(vault.frozen());
    }

    // ------------------------------------------------------------ B14: front-running a relayed request
    function test_T_B14_frontRun() public {
        uint256 d = ts() + 1 hours;
        bytes32[5] memory f = f3(addr32(address(0)), addr32(funder), bytes32(uint256(5 ether)));
        bytes memory s = ownerSig(A_WITHDRAW, d, f);
        uint256 fb = funder.balance;
        vm.prank(attacker); // the attacker submits the owner's signed request first
        vault.withdraw(address(0), funder, 5 ether, d, ownerPk, s);
        assertEq(funder.balance, fb + 5 ether); // the money still went to the signed recipient
        assertEq(attacker.balance, 0);
    }

    // ------------------------------------------------------------ B15: reentrancy
    function test_T_B15_reentrancy_withdraw() public {
        Reenterer r = new Reenterer();
        address[] memory rec = new address[](1);
        rec[0] = address(r);
        address[] memory toks = new address[](0);
        KavachVault.Limits[] memory lim = new KavachVault.Limits[](1);
        lim[0] = KavachVault.Limits(25 ether, 100 ether);
        KavachVault v2 = new KavachVault(ownerPk, ownerAcct, keccak256(guardianPk), rec, toks, lim, 6 hours);
        (bool ok,) = address(v2).call{value: 100 ether}("");
        assertTrue(ok);
        uint256 d = ts() + 1 hours;
        bytes32[5] memory f = f3(addr32(address(0)), addr32(address(r)), bytes32(uint256(1 ether)));
        bytes memory s = signWith(OWNER_SECRET, ownerPk, v2.messageFor(A_WITHDRAW, OWNER, d, f));
        r.arm(v2, ownerPk, s, d, bytes32(0), 0);
        v2.withdraw(address(0), address(r), 1 ether, d, ownerPk, s);
        assertEq(address(r).balance, 1 ether, "exactly one withdrawal");
        assertFalse(r.reentered());
        assertEq(r.attempts(), 1);
    }

    function test_T_B15_reentrancy_execute() public {
        Reenterer r = new Reenterer();
        address[] memory rec = new address[](1);
        rec[0] = address(r);
        address[] memory toks = new address[](0);
        KavachVault.Limits[] memory lim = new KavachVault.Limits[](1);
        lim[0] = KavachVault.Limits(25 ether, 100 ether);
        KavachVault v2 = new KavachVault(ownerPk, ownerAcct, keccak256(guardianPk), rec, toks, lim, 6 hours);
        (bool ok,) = address(v2).call{value: 100 ether}("");
        assertTrue(ok);
        uint256 d = ts() + 1 hours;
        bytes32[5] memory f = f3(addr32(address(0)), addr32(address(r)), bytes32(uint256(3 ether)));
        bytes memory s = signWith(OWNER_SECRET, ownerPk, v2.messageFor(A_QWITHDRAW, OWNER, d, f));
        bytes32 id = v2.queueAction(A_QWITHDRAW, f, d, ownerPk, s);
        vm.warp(ts() + 6 hours);
        r.arm(v2, ownerPk, s, d, id, 1);
        v2.execute(id);
        assertEq(address(r).balance, 3 ether);
        assertFalse(r.reentered());
    }

    // ------------------------------------------------------------ B16: forced QOR does not change accounting
    function test_T_B16_forceSend() public {
        uint256 spentBefore = vault.spentInWindow(address(0));
        new ForceSend{value: 7 ether}(payable(address(vault)));
        assertEq(vault.spentInWindow(address(0)), spentBefore);
        (uint128 p, uint128 dl) = vault.limits(address(0));
        assertEq(p, 25 ether);
        assertEq(dl, 100 ether);
        doWithdraw(address(0), funder, 25 ether); // still works, limits unchanged
        assertEq(vault.spentInWindow(address(0)), 25 ether);
    }

    // ------------------------------------------------------------ B17: fake and lying tokens
    function test_T_B17_fakeToken() public {
        LyingToken lt = new LyingToken();
        vm.expectRevert(KavachVault.NotListed.selector);
        vault.depositToken(address(lt), 1e6);
        MockToken other = new MockToken();
        other.mint(attacker, 1e6);
        vm.startPrank(attacker);
        other.approve(address(vault), 1e6);
        vm.expectRevert(KavachVault.NotListed.selector);
        vault.depositToken(address(other), 1e6);
        vm.stopPrank();
    }

    // ------------------------------------------------------------ B18: queue and heartbeat grief
    function test_T_B18_queueGrief() public {
        bytes32[5] memory f = f3(addr32(address(0)), addr32(funder), bytes32(uint256(1 ether)));
        uint256 d = ts() + 1 hours;
        vm.startPrank(attacker);
        for (uint256 i = 0; i < 5; i++) {
            vm.expectRevert(KavachVault.BadSignature.selector);
            vault.queueAction(A_QWITHDRAW, f, d, ownerPk, new bytes(4627));
            vm.expectRevert(KavachVault.UnknownAction.selector);
            vault.execute(keccak256(abi.encode(i)));
            vm.expectRevert(KavachVault.BadSignature.selector);
            vault.heartbeat(d, ownerPk, new bytes(4627));
            vm.expectRevert(KavachVault.BadSignature.selector);
            vault.freeze(OWNER, d, ownerPk, new bytes(4627));
            vm.expectRevert(KavachVault.BadSignature.selector);
            vault.freeze(GUARDIAN, d, guardianPk, new bytes(4627));
        }
        vm.stopPrank();
        assertFalse(vault.frozen());
        assertEq(vault.nonces(OWNER), 0);
        assertEq(vault.nonces(GUARDIAN), 0);
    }

    // ------------------------------------------------------------ B19: precompile missing, empty, or lying about key status
    function test_T_B19_precompileMissing() public {
        uint256 d = ts() + 1 hours;
        bytes memory s = ownerSig(A_WITHDRAW, d, f3(addr32(address(0)), addr32(funder), bytes32(uint256(1 ether))));
        vm.etch(PQC_VERIFY, ""); // pqcVerify precompile absent
        vm.expectRevert(); // typed call to an address with no code reverts
        vault.withdraw(address(0), funder, 1 ether, d, ownerPk, s);
    }

    function test_T_B19_emptyReturnData() public {
        uint256 d = ts() + 1 hours;
        bytes memory s = ownerSig(A_WITHDRAW, d, f3(addr32(address(0)), addr32(funder), bytes32(uint256(1 ether))));
        vm.etch(PQC_VERIFY, address(new EmptyReturn()).code); // answers but returns nothing
        vm.expectRevert();
        vault.withdraw(address(0), funder, 1 ether, d, ownerPk, s);
    }

    function test_T_B19_statusPrecompileMissingOrEmpty() public {
        uint256 d = ts() + 1 hours;
        bytes memory s = ownerSig(A_WITHDRAW, d, f3(addr32(address(0)), addr32(funder), bytes32(uint256(1 ether))));
        vm.etch(PQC_STATUS, "");
        vm.expectRevert();
        vault.withdraw(address(0), funder, 1 ether, d, ownerPk, s);
        vm.etch(PQC_STATUS, address(new EmptyReturn()).code);
        vm.expectRevert();
        vault.withdraw(address(0), funder, 1 ether, d, ownerPk, s);
    }

    function test_T_B19_statusFieldsAllRequired() public {
        uint256 d = ts() + 1 hours;
        bytes memory s = ownerSig(A_WITHDRAW, d, f3(addr32(address(0)), addr32(funder), bytes32(uint256(1 ether))));
        MockPQCStatus(PQC_STATUS).set(ownerAcct, false, 1, ownerPk, true);
        vm.expectRevert(KavachVault.KeyStatus.selector);
        vault.withdraw(address(0), funder, 1 ether, d, ownerPk, s);
        MockPQCStatus(PQC_STATUS).set(ownerAcct, true, 0, ownerPk, true);
        vm.expectRevert(KavachVault.KeyStatus.selector);
        vault.withdraw(address(0), funder, 1 ether, d, ownerPk, s);
        MockPQCStatus(PQC_STATUS).set(ownerAcct, true, 1, ownerPk, false);
        vm.expectRevert(KavachVault.KeyStatus.selector);
        vault.withdraw(address(0), funder, 1 ether, d, ownerPk, s);
        MockPQCStatus(PQC_STATUS).set(ownerAcct, true, 1, ownerPk, true);
        vault.withdraw(address(0), funder, 1 ether, d, ownerPk, s); // restored: works
    }

    // ------------------------------------------------------------ surface: no way for anyone to change rules instantly
    function test_surface_noInstantRuleChange() public {
        // limits, recipients and delay can only change through queue + timelock, never directly
        (bool ok,) = address(vault).call(abi.encodeWithSignature("setLimits(address,uint128,uint128)", address(0), 1, 1));
        assertFalse(ok);
        (ok,) = address(vault).call(abi.encodeWithSignature("setRecipient(address,bool)", attacker, true));
        assertFalse(ok);
        (ok,) = address(vault).call(abi.encodeWithSignature("transferOwnership(address)", attacker));
        assertFalse(ok);
        (ok,) = address(vault).call(abi.encodeWithSignature("upgradeTo(address)", attacker));
        assertFalse(ok);
        (ok,) = address(vault).call(abi.encodeWithSignature("approve(address,uint256)", attacker, 1));
        assertFalse(ok);
    }

    // The reentrancy guard must hold even when the nonce/queue bookkeeping would not save us: re-enter a DIFFERENT
    // function that is independently valid at that moment (a queued entry whose delay already passed).
    function _reentrancyVault(Reenterer r) internal returns (KavachVault v2) {
        address[] memory rec = new address[](1);
        rec[0] = address(r);
        address[] memory toks = new address[](0);
        KavachVault.Limits[] memory lim = new KavachVault.Limits[](1);
        lim[0] = KavachVault.Limits(25 ether, 100 ether);
        v2 = new KavachVault(ownerPk, ownerAcct, keccak256(guardianPk), rec, toks, lim, 6 hours);
        (bool ok,) = address(v2).call{value: 100 ether}("");
        assertTrue(ok);
    }

    function _queueTo(KavachVault v2, address to, uint256 amt) internal returns (bytes32 id) {
        uint256 d = ts() + 1 hours;
        bytes32[5] memory f = f3(addr32(address(0)), addr32(to), bytes32(amt));
        bytes memory s = signWith(OWNER_SECRET, ownerPk, v2.messageFor(A_QWITHDRAW, OWNER, d, f));
        id = v2.queueAction(A_QWITHDRAW, f, d, ownerPk, s);
    }

    function test_T_B15_withdrawCannotReenterExecute() public {
        Reenterer r = new Reenterer();
        KavachVault v2 = _reentrancyVault(r);
        bytes32 id = _queueTo(v2, address(r), 3 ether);
        vm.warp(ts() + 6 hours); // the queued entry is now executable
        uint256 d = ts() + 1 hours;
        bytes32[5] memory f = f3(addr32(address(0)), addr32(address(r)), bytes32(uint256(1 ether)));
        bytes memory s = signWith(OWNER_SECRET, ownerPk, v2.messageFor(A_WITHDRAW, OWNER, d, f));
        r.arm(v2, ownerPk, s, d, id, 1); // on payment, try to execute the queued entry
        v2.withdraw(address(0), address(r), 1 ether, d, ownerPk, s);
        assertFalse(r.reentered(), "execute was reachable from inside withdraw");
        assertEq(address(r).balance, 1 ether);
        v2.execute(id); // still executable normally afterwards
        assertEq(address(r).balance, 4 ether);
    }

    function test_T_B15_executeCannotReenterExecute() public {
        Reenterer r = new Reenterer();
        KavachVault v2 = _reentrancyVault(r);
        bytes32 id1 = _queueTo(v2, address(r), 3 ether);
        bytes32 id2 = _queueTo(v2, address(r), 5 ether);
        vm.warp(ts() + 6 hours);
        r.arm(v2, ownerPk, "", 0, id2, 1); // while id1 pays out, try to execute id2
        v2.execute(id1);
        assertFalse(r.reentered(), "execute was reachable from inside execute");
        assertEq(address(r).balance, 3 ether);
        v2.execute(id2);
        assertEq(address(r).balance, 8 ether);
    }

    function testFuzz_withdrawNeverExceedsPerTx(uint256 amt) public {
        amt = bound(amt, 25 ether + 1, type(uint128).max);
        uint256 d = ts() + 1 hours;
        bytes memory s = ownerSig(A_WITHDRAW, d, f3(addr32(address(0)), addr32(funder), bytes32(amt)));
        vm.expectRevert(KavachVault.OverPerTx.selector);
        vault.withdraw(address(0), funder, amt, d, ownerPk, s);
    }
}
