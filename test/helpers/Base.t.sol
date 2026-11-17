// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {KavachVault} from "../../src/KavachVault.sol";
import {KavachMessage} from "../../src/libs/KavachMessage.sol";
import {MockPQCVerify, MockPQCStatus} from "../mocks/MockPQC.sol";

contract MockToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 a) external {
        balanceOf[to] += a;
    }

    function approve(address s, uint256 a) external returns (bool) {
        allowance[msg.sender][s] = a;
        return true;
    }

    function transfer(address to, uint256 a) external returns (bool) {
        balanceOf[msg.sender] -= a;
        balanceOf[to] += a;
        return true;
    }

    function transferFrom(address f, address to, uint256 a) external returns (bool) {
        allowance[f][msg.sender] -= a;
        balanceOf[f] -= a;
        balanceOf[to] += a;
        return true;
    }
}

abstract contract Base is Test {
    address constant PQC_VERIFY = 0x0000000000000000000000000000000000000a01;
    address constant PQC_STATUS = 0x0000000000000000000000000000000000000a02;
    uint8 constant OWNER = 1;
    uint8 constant GUARDIAN = 2;
    uint256 constant A_WITHDRAW = 1;
    uint256 constant A_QWITHDRAW = 2;
    uint256 constant A_QLIMITS = 3;
    uint256 constant A_QRECIP = 4;
    uint256 constant A_QDELAY = 5;
    uint256 constant A_CANCEL = 8;
    uint256 constant A_FREEZE = 9;
    uint256 constant A_UNFREEZE = 10;
    uint256 constant A_HEARTBEAT = 11;

    KavachVault vault;
    MockToken fusd;
    MockToken feth;
    address ownerAcct = address(0xD211);
    address funder = address(0xF00D);
    address attacker = address(0xBAD);
    bytes ownerPk;
    bytes guardianPk;
    bytes attackerPk;
    bytes32 constant OWNER_SECRET = keccak256("owner-secret");
    bytes32 constant GUARD_SECRET = keccak256("guardian-secret");
    bytes32 constant ATTACKER_SECRET = keccak256("attacker-secret");

    function pk(string memory seed) internal pure returns (bytes memory b) {
        b = new bytes(2592);
        bytes32 h = keccak256(bytes(seed));
        for (uint256 i = 0; i < 2592; i += 32) {
            h = keccak256(abi.encode(h, i));
            for (uint256 j = 0; j < 32 && i + j < 2592; j++) b[i + j] = h[j];
        }
    }

    function setUp() public virtual {
        vm.chainId(9800);
        vm.warp(1_800_000_000);
        vm.etch(PQC_VERIFY, address(new MockPQCVerify()).code);
        vm.etch(PQC_STATUS, address(new MockPQCStatus()).code);
        ownerPk = pk("owner");
        guardianPk = pk("guardian");
        attackerPk = pk("attacker");
        MockPQCVerify(PQC_VERIFY).setSecret(ownerPk, OWNER_SECRET);
        MockPQCVerify(PQC_VERIFY).setSecret(guardianPk, GUARD_SECRET);
        MockPQCVerify(PQC_VERIFY).setSecret(attackerPk, ATTACKER_SECRET);
        MockPQCStatus(PQC_STATUS).set(ownerAcct, true, 1, ownerPk, true);
        fusd = new MockToken();
        feth = new MockToken();
        address[] memory rec = new address[](1);
        rec[0] = funder;
        address[] memory toks = new address[](2);
        toks[0] = address(fusd);
        toks[1] = address(feth);
        KavachVault.Limits[] memory lim = new KavachVault.Limits[](3);
        lim[0] = KavachVault.Limits(25 ether, 100 ether); // QOR
        lim[1] = KavachVault.Limits(250e6, 1000e6); // fUSD
        lim[2] = KavachVault.Limits(0.1 ether, 0.5 ether); // fETH
        vault = new KavachVault(ownerPk, ownerAcct, keccak256(guardianPk), rec, toks, lim, 6 hours);
        vm.deal(address(this), 1000 ether);
        (bool ok,) = address(vault).call{value: 500 ether}("");
        require(ok);
        fusd.mint(address(this), 10_000e6);
        fusd.approve(address(vault), type(uint256).max);
        vault.depositToken(address(fusd), 5_000e6);
    }

    // ---- helpers ----
    /// block.timestamp can be cached by the optimizer across vm.warp; always read the live value.
    function ts() internal view returns (uint256) {
        return vm.getBlockTimestamp();
    }

    function f3(bytes32 a, bytes32 b, bytes32 c) internal pure returns (bytes32[5] memory f) {
        f[0] = a;
        f[1] = b;
        f[2] = c;
    }

    function addr32(address a) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(a)));
    }

    function msgFor(uint256 action, uint8 role, uint256 deadline, bytes32[5] memory f) internal view returns (bytes memory) {
        return vault.messageFor(action, role, deadline, f);
    }

    function signWith(bytes32 secret, bytes memory pubkey, bytes memory m) internal view returns (bytes memory) {
        return MockPQCVerify(PQC_VERIFY).sign(secret, pubkey, m);
    }

    function ownerSig(uint256 action, uint256 deadline, bytes32[5] memory f) internal view returns (bytes memory) {
        return signWith(OWNER_SECRET, ownerPk, msgFor(action, OWNER, deadline, f));
    }

    function guardianSig(uint256 action, uint256 deadline, bytes32[5] memory f) internal view returns (bytes memory) {
        return signWith(GUARD_SECRET, guardianPk, msgFor(action, GUARDIAN, deadline, f));
    }

    function doWithdraw(address asset, address to, uint256 amount) internal returns (uint256 deadline) {
        deadline = ts() + 1 hours;
        bytes memory sig = ownerSig(A_WITHDRAW, deadline, f3(addr32(asset), addr32(to), bytes32(amount)));
        vault.withdraw(asset, to, amount, deadline, ownerPk, sig);
    }
}
