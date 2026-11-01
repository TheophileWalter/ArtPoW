// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Exp2} from "../src/Exp2.sol";
import {ArtPoW} from "../src/ArtPoW.sol";
import {Harness} from "./ArtPoW.t.sol";

/// @dev Production contract (no floor override), exposing the schedule.
contract ProdHarness is ArtPoW {
    constructor() ArtPoW("T", "T", "d", address(0)) {}

    function scheduleTarget(uint256 duration, uint256 elapsed, uint256 minted) external pure returns (uint256) {
        return _scheduleTarget(duration, elapsed, minted);
    }
}

/// @notice Checks the contract against the Python port used by the simulations (sim/difficulty.py).
/// Regenerate the vectors with `python3 sim/vectors.py`.
contract DifferentialTest is Test {
    string json;

    function setUp() public {
        json = vm.readFile("sim/vectors.json");
    }

    function test_Exp2MatchesPython() public view {
        uint256[] memory x = vm.parseJsonUintArray(json, ".exp2.x");
        int256[] memory num = vm.parseJsonIntArray(json, ".exp2.num");
        uint256[] memory cap = vm.parseJsonUintArray(json, ".exp2.cap");
        uint256[] memory out = vm.parseJsonUintArray(json, ".exp2.out");
        for (uint256 i = 0; i < x.length; i++) {
            assertEq(Exp2.mulExp2(x[i], num[i], 43200, cap[i]), out[i]);
        }
    }

    function test_ScheduleTargetMatchesPython() public {
        Harness nft = new Harness("T", "T", "d", address(1));
        uint256[] memory duration = vm.parseJsonUintArray(json, ".schedule.duration");
        uint256[] memory elapsed = vm.parseJsonUintArray(json, ".schedule.elapsed");
        uint256[] memory minted = vm.parseJsonUintArray(json, ".schedule.minted");
        uint256[] memory out = vm.parseJsonUintArray(json, ".schedule.out");
        for (uint256 i = 0; i < duration.length; i++) {
            assertEq(nft.scheduleTarget(duration[i], elapsed[i], minted[i]), out[i]);
        }
    }

    function test_ProductionScheduleMatchesPython() public {
        vm.roll(10);
        ProdHarness nft = new ProdHarness();
        assertEq(nft.MAX_TARGET(), uint256(1) << 228);
        uint256[] memory duration = vm.parseJsonUintArray(json, ".schedule_prod.duration");
        uint256[] memory elapsed = vm.parseJsonUintArray(json, ".schedule_prod.elapsed");
        uint256[] memory minted = vm.parseJsonUintArray(json, ".schedule_prod.minted");
        uint256[] memory out = vm.parseJsonUintArray(json, ".schedule_prod.out");
        for (uint256 i = 0; i < duration.length; i++) {
            assertEq(nft.scheduleTarget(duration[i], elapsed[i], minted[i]), out[i]);
        }
    }
}
