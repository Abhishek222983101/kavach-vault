// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {Handler} from "./Handler.sol";

contract InvariantsTest is Test {
    Handler h;

    function setUp() public {
        h = new Handler();
        targetContract(address(h));
        bytes4[] memory sel = new bytes4[](14);
        sel[0] = h.ownerWithdraw.selector;
        sel[1] = h.ownerQueueWithdraw.selector;
        sel[2] = h.executeQueued.selector;
        sel[3] = h.ownerFreeze.selector;
        sel[4] = h.guardianFreeze.selector;
        sel[5] = h.unfreezeBoth.selector;
        sel[6] = h.ownerHeartbeat.selector;
        sel[7] = h.warpTime.selector;
        sel[8] = h.deposit.selector;
        sel[9] = h.guardianTryWithdraw.selector;
        sel[10] = h.attackerWithdraw.selector;
        sel[11] = h.attackerReplay.selector;
        sel[12] = h.attackerQueueAndExecute.selector;
        sel[13] = h.attackerForceSend.selector;
        targetSelector(FuzzSelector({addr: address(h), selectors: sel}));
    }

    /// Proves the campaign actually reached the interesting states (otherwise green invariants would mean little).
    function afterInvariant() public view {
        console2.log("owner calls ok:", h.successfulOwnerCalls());
        console2.log("QOR out (wei):", h.qorOut());
        console2.log("fUSD out:", h.tokOut());
    }

    function invariant_I1_I2_balancesExactNoUnauthorizedOutflow() public view {
        assertTrue(h.inv_balancesExact(), "vault balance moved without an owner-signed request");
    }

    function invariant_I2_attackersReceiveNothing() public view {
        assertTrue(h.inv_attackersGotNothing());
    }

    function invariant_I5_guardianNeverMovesFunds() public view {
        assertTrue(h.inv_guardianNeverMovesFunds());
    }

    function invariant_I4_dailyCapInAny24HourInterval() public view {
        assertTrue(h.inv_dailyCapRespected());
    }

    function invariant_I4b_windowAccountingBounded() public view {
        assertTrue(h.inv_windowAccountingBounded());
    }

    function invariant_I3_rulesNeverChangeWithoutTimelock() public view {
        assertTrue(h.inv_limitsAndRecipientsUnchanged());
    }
}
