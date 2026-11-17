// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Handler} from "../invariant/Handler.sol";

/// Second fuzzing engine (Medusa) on the same properties as the Foundry invariants.
contract Props is Handler {
    function property_balancesExact() public view returns (bool) { return inv_balancesExact(); }
    function property_attackersGotNothing() public view returns (bool) { return inv_attackersGotNothing(); }
    function property_guardianNeverMovesFunds() public view returns (bool) { return inv_guardianNeverMovesFunds(); }
    function property_dailyCapRespected() public view returns (bool) { return inv_dailyCapRespected(); }
    function property_windowAccountingBounded() public view returns (bool) { return inv_windowAccountingBounded(); }
    function property_rulesUnchanged() public view returns (bool) { return inv_limitsAndRecipientsUnchanged(); }
}

/// Canaries: each of these is EXPECTED to be reported as FAILED by Medusa. A failure proves the fuzzer reached the state
/// (a successful owner withdrawal, an executed queue entry, a freeze, a heartbeat, a replayed request), so the green
/// safety properties above were evaluated in meaningful states and not only in trivial ones.
contract PropsWithCanaries is Handler {
    function property_balancesExact() public view returns (bool) { return inv_balancesExact(); }
    function property_attackersGotNothing() public view returns (bool) { return inv_attackersGotNothing(); }
    function property_guardianNeverMovesFunds() public view returns (bool) { return inv_guardianNeverMovesFunds(); }
    function property_dailyCapRespected() public view returns (bool) { return inv_dailyCapRespected(); }
    function property_windowAccountingBounded() public view returns (bool) { return inv_windowAccountingBounded(); }
    function property_rulesUnchanged() public view returns (bool) { return inv_limitsAndRecipientsUnchanged(); }

    function property_CANARY_withdrawalReached() public view returns (bool) { return qorOut == 0 && tokOut == 0; }
    function property_CANARY_queueExecuted() public view returns (bool) {
        for (uint256 i = 0; i < qs.length; i++) if (qs[i].executed) return false;
        return true;
    }
    function property_CANARY_vaultFrozen() public view returns (bool) { return !vault.frozen(); }
    function property_CANARY_nonceAdvanced() public view returns (bool) { return vault.nonces(1) < 10; }
}
