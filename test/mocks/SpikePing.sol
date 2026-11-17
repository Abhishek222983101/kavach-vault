// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Spike S3 only: records who called, to prove a native MsgCrossVMCall reaches the EVM as the sender's 0x address.
contract SpikePing {
    event Pinged(address indexed caller, uint256 n);
    uint256 public count;
    address public lastCaller;

    function ping() external {
        count += 1;
        lastCaller = msg.sender;
        emit Pinged(msg.sender, count);
    }
}
