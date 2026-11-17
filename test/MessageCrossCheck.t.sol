// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./helpers/Base.t.sol";
import {KavachMessage} from "../src/libs/KavachMessage.sol";

/// The Solidity message builder and the TypeScript signer must produce identical bytes, otherwise real signatures
/// would never verify on chain. Uses Foundry ffi (tests only).
contract MessageCrossCheck is Base {
    function _ts(uint256 action, uint256 role, uint256 nonce, uint256 deadline, bytes32[5] memory f) internal returns (bytes memory) {
        string[] memory cmd = new string[](13);
        cmd[0] = "node";
        cmd[1] = "scripts/lib/messages.mjs";
        cmd[2] = vm.toString(address(vault));
        cmd[3] = vm.toString(action);
        cmd[4] = vm.toString(role);
        cmd[5] = vm.toString(nonce);
        cmd[6] = vm.toString(deadline);
        for (uint256 i = 0; i < 5; i++) cmd[7 + i] = vm.toString(f[i]);
        cmd[12] = "";
        string[] memory c2 = new string[](12);
        for (uint256 i = 0; i < 12; i++) c2[i] = cmd[i];
        return vm.ffi(c2);
    }

    function test_solidityAndTypescriptAgree() public {
        uint256[6] memory actions = [uint256(1), 2, 3, 9, 10, 11];
        for (uint256 i = 0; i < actions.length; i++) {
            for (uint256 role = 1; role <= 2; role++) {
                bytes32[5] memory f = f3(addr32(address(fusd)), addr32(funder), bytes32(uint256(keccak256(abi.encode(i, role))) % 1e30));
                f[3] = keccak256(abi.encode("x", i));
                f[4] = bytes32(uint256(role));
                uint256 d = 1_800_003_600 + i * 77 + role;
                bytes memory a = vault.messageFor(actions[i], uint8(role), d, f);
                bytes memory b = _ts(actions[i], role, vault.nonces(uint8(role)), d, f);
                assertEq(a.length, 416);
                assertEq(b.length, 416);
                assertEq(keccak256(a), keccak256(b), "Solidity and TypeScript messages differ");
            }
        }
    }

    function test_messageStartsWith0xFF_andDomainText() public view {
        bytes memory m = vault.messageFor(11, 1, 1, f3(0, 0, 0));
        assertEq(uint8(m[0]), 0xFF);
        assertEq(m.length, 416);
        // "KAVACH-VAULT-v1" follows the 0xFF byte
        bytes memory name = "KAVACH-VAULT-v1";
        for (uint256 i = 0; i < name.length; i++) assertEq(m[1 + i], name[i]);
    }

    function test_messageBindsEveryField() public view {
        bytes32[5] memory f = f3(bytes32(uint256(1)), bytes32(uint256(2)), bytes32(uint256(3)));
        bytes32 base = keccak256(vault.messageFor(1, 1, 100, f));
        assertTrue(base != keccak256(vault.messageFor(2, 1, 100, f)), "action");
        assertTrue(base != keccak256(vault.messageFor(1, 2, 100, f)), "role");
        assertTrue(base != keccak256(vault.messageFor(1, 1, 101, f)), "deadline");
        bytes32[5] memory g = f3(bytes32(uint256(1)), bytes32(uint256(2)), bytes32(uint256(4)));
        assertTrue(base != keccak256(vault.messageFor(1, 1, 100, g)), "field 2");
        g = f;
        g[4] = bytes32(uint256(1));
        assertTrue(base != keccak256(vault.messageFor(1, 1, 100, g)), "field 4");
    }
}
