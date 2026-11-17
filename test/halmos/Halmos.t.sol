// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {KavachVault} from "../../src/KavachVault.sol";
import {KavachColdVault} from "../../src/KavachColdVault.sol";
import {MockPQCStatus} from "../mocks/MockPQC.sol";

/// Test-only subclass: exposes the internal limit accounting and a way to start in the frozen state.
contract VaultHarness is KavachVault {
    constructor(bytes memory pk, address acct, bytes32 g, address[] memory r, address[] memory t, Limits[] memory l, uint64 d)
        KavachVault(pk, acct, g, r, t, l, d)
    {}

    function spendPublic(address asset, uint256 amount) external {
        (, uint128 daily) = (limits[asset].perTx, limits[asset].daily);
        _spend(asset, amount, daily);
    }

    function forceFrozen() external {
        frozen = true;
    }
}

/// Symbolic checks (Halmos): the properties hold for ALL inputs within the stated bounds, not for sampled ones.
/// Run: halmos --contract HalmosTest --solver-timeout-assertion 0
contract HalmosTest is Test {
    address constant PQC_STATUS = 0x0000000000000000000000000000000000000a02;
    VaultHarness vh;
    KavachColdVault cold;
    address owner = address(0xD211);
    address funder = address(0xF00D);

    function setUp() public {
        vm.chainId(9800);
        vm.etch(PQC_STATUS, address(new MockPQCStatus()).code);
        bytes memory pk = new bytes(2592);
        MockPQCStatus(PQC_STATUS).set(owner, true, 1, pk, true);
        address[] memory rec = new address[](1);
        rec[0] = funder;
        address[] memory toks = new address[](0);
        KavachVault.Limits[] memory lim = new KavachVault.Limits[](1);
        lim[0] = KavachVault.Limits(25 ether, 100 ether);
        vh = new VaultHarness(pk, owner, bytes32(uint256(1)), rec, toks, lim, 6 hours);
        vm.warp(1_800_000_000);
        cold = new KavachColdVault(pk, owner, rec, toks, uint64(1_800_172_800));
    }

    /// Two arbitrary spends separated by an arbitrary time gap never push the tracked 25-hour window past the daily cap.
    function check_dailyCapNeverExceeded(uint96 a1, uint96 a2, uint32 gap) public {
        vm.assume(a1 > 0 && a2 > 0);
        try vh.spendPublic(address(0), a1) {} catch {}
        vm.warp(block.timestamp + gap);
        try vh.spendPublic(address(0), a2) {} catch {}
        assert(vh.spentInWindow(address(0)) <= 100 ether);
    }

    /// For any time before RELEASE_TIME and any arguments, the cold vault refuses to release, before looking at anything else.
    function check_coldLockedBeforeRelease(uint64 t, address asset, address to, uint256 amount, uint256 deadline) public {
        vm.assume(t < cold.RELEASE_TIME());
        vm.warp(t);
        try cold.release(asset, to, amount, deadline, new bytes(2592), new bytes(4627)) {
            assert(false);
        } catch (bytes memory err) {
            assert(bytes4(err) == KavachColdVault.Locked.selector);
        }
    }

    /// While frozen, withdraw, queueAction and execute all refuse for any arguments (heartbeat is the only money-free path).
    function check_frozenBlocksMovement(address asset, address to, uint256 amount, uint256 deadline, bytes32 id) public {
        vh.forceFrozen();
        try vh.withdraw(asset, to, amount, deadline, new bytes(2592), new bytes(4627)) {
            assert(false);
        } catch (bytes memory e1) {
            assert(bytes4(e1) == KavachVault.Frozen.selector);
        }
        bytes32[5] memory f;
        try vh.queueAction(2, f, deadline, new bytes(2592), new bytes(4627)) {
            assert(false);
        } catch (bytes memory e2) {
            assert(bytes4(e2) == KavachVault.Frozen.selector);
        }
        try vh.execute(id) {
            assert(false);
        } catch (bytes memory e3) {
            assert(bytes4(e3) == KavachVault.Frozen.selector);
        }
    }

    /// A withdrawal to any address that is not allowlisted always reverts (with a correct-shaped but arbitrary request).
    function check_notAllowlistedRecipientNeverPaid(address to, uint256 amount, uint256 deadline) public {
        vm.assume(to != funder);
        try vh.withdraw(address(0), to, amount, deadline, new bytes(2592), new bytes(4627)) {
            assert(false);
        } catch {}
    }
}
