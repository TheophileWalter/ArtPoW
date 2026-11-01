// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ArtPoW} from "../src/ArtPoW.sol";
import {Harness} from "./ArtPoW.t.sol";

/// @dev Drives random sequences of claims, proofs, transfers, scheduling, time jumps and announcements.
/// Ghost variables record what the contract should contain.
contract Handler is Test {
    Harness public nft;
    uint256 public constant FIRST_START = 1_800_000_000 + 1 hours;

    address[] public actors;
    mapping(uint256 month => address[]) public monthRecipients; // every token, in mint order
    mapping(uint256 month => address[]) public minedRecipients; // mined tokens only
    mapping(uint256 month => mapping(address => bool)) public ghostClaimed;
    uint256 public ghostMinted;
    uint256 public ghostProofs;
    mapping(address => bool) public ghostAccepted; // went through proposeAdmin + acceptAdmin

    constructor(Harness nft_) {
        nft = nft_;
        for (uint160 i = 1; i <= 100; i++) {
            actors.push(address(0x1000 + i));
        }
    }

    function recipientCount(uint256 month) external view returns (uint256) {
        return monthRecipients[month].length;
    }

    function minedCount(uint256 month) external view returns (uint256) {
        return minedRecipients[month].length;
    }

    /// Mines and claims for a random actor if the active month is not too far ahead of schedule.
    function claim(uint256 actorSeed) external {
        uint256 month = nft.activeMonth();
        if (month == 0) return;
        address to = actors[actorSeed % actors.length];
        if (nft.hasClaimed(month, to)) return;
        uint256 target = nft.currentTarget(month);
        if (target < (uint256(1) << 242)) return; // keep mining cheap (< ~2^14 hashes)

        bytes32 seed = nft.monthSeed(month);
        uint256 nonce;
        while (uint256(keccak256(abi.encode(seed, month, to, nonce))) >= target) nonce++;
        nft.claim(month, to, nonce);
        _record(month, to, true);
        ghostMinted++;
    }

    function claimProof(bool artist) external {
        uint256 month = nft.activeMonth();
        if (month == 0) return;
        (bool artistDone, bool teamDone) = nft.proofsMinted(month);
        if (artist ? artistDone : teamDone) return;
        (,,,, ArtPoW.MonthContent memory c) = nft.getMonth(month);
        address to = artist ? c.artistAddress : nft.teamRecipient();
        if (to == address(0)) return; // proofs do not depend on the recipient's mined claim
        nft.claimReserved(month, artist ? ArtPoW.Edition.ArtistProof : ArtPoW.Edition.TeamProof);
        _record(month, to, false);
        ghostProofs++;
    }

    function transfer(uint256 tokenSeed, uint256 actorSeed) external {
        uint256 total = nft.totalMinted();
        if (total == 0) return;
        uint256 id = tokenSeed % total + 1;
        address from = nft.ownerOf(id);
        vm.prank(from);
        nft.transferFrom(from, actors[actorSeed % actors.length], id);
    }

    function warp(uint256 secondsAhead) external {
        vm.warp(block.timestamp + bound(secondsAhead, 1, 12 hours));
    }

    /// Schedules the next month right after the last one (or later), with a random valid duration.
    function scheduleNext(uint256 durationSeed, uint256 gapSeed, uint256 artistSeed) external {
        uint256 count = nft.monthCount();
        (, uint64 lastEnd,,,) = nft.getMonth(count);
        uint256 start = lastEnd + bound(gapSeed, 0, 5 days);
        if (start <= block.timestamp) start = block.timestamp + 1;
        uint256 end = start + bound(durationSeed, 25 days, 35 days);
        ArtPoW.MonthContent memory c = ArtPoW.MonthContent({
            label: "Month",
            artist: "Artist",
            artistAddress: artistSeed % 3 == 0 ? address(0) : actors[artistSeed % actors.length],
            image: "ipfs://image",
            animationUrl: ""
        });
        nft.scheduleMonth(count + 1, uint64(start), uint64(end), c);
    }

    function announce(uint256 monthSeed) external {
        uint256 count = nft.monthCount();
        uint256 month = monthSeed % count + 1;
        (,,, bool closed,) = nft.getMonth(month);
        (bool ok,) = address(nft).call(abi.encodeCall(nft.announceMonthTotal, (month)));
        // Allowed exactly once per closed month; a second call reverts.
        if (!closed) assertFalse(ok);
    }

    // Administration: actors are proposed, accept, get revoked or renounce. The handler stays an administrator.

    function proposeAdmin(uint256 actorSeed) external {
        address a = actors[actorSeed % actors.length];
        if (nft.hasRole(0x00, a)) return;
        nft.proposeAdmin(a);
    }

    function acceptAdmin(uint256 actorSeed) external {
        address a = actors[actorSeed % actors.length];
        if (!nft.isProposedAdmin(a)) return;
        vm.prank(a);
        nft.acceptAdmin();
        ghostAccepted[a] = true;
    }

    function cancelProposal(uint256 actorSeed) external {
        address a = actors[actorSeed % actors.length];
        if (!nft.isProposedAdmin(a)) return;
        nft.cancelAdminProposal(a);
    }

    function removeAdmin(uint256 actorSeed, bool renounce) external {
        address a = actors[actorSeed % actors.length];
        if (!nft.hasRole(0x00, a)) return;
        if (renounce) {
            vm.prank(a);
            nft.renounceRole(0x00, a);
        } else {
            nft.revokeRole(0x00, a);
        }
    }

    function _record(uint256 month, address to, bool mined) internal {
        monthRecipients[month].push(to);
        if (!mined) return;
        assertFalse(ghostClaimed[month][to], "address claimed twice in a month");
        ghostClaimed[month][to] = true;
        minedRecipients[month].push(to);
    }
}

contract InvariantsTest is Test {
    Harness nft;
    Handler handler;

    function setUp() public {
        vm.warp(1_800_000_000);
        nft = new Harness("Test PoW", "TPOW", "Monthly test NFT", address(0xBEEF));
        handler = new Handler(nft);
        nft.proposeAdmin(address(handler));
        vm.prank(address(handler));
        nft.acceptAdmin();
        nft.scheduleMonth(
            1,
            uint64(handler.FIRST_START()),
            uint64(handler.FIRST_START() + 30 days),
            ArtPoW.MonthContent({
                label: "Month",
                artist: "Artist",
                artistAddress: address(0xA11CE),
                image: "ipfs://image",
                animationUrl: ""
            })
        );
        vm.warp(handler.FIRST_START());

        bytes4[] memory selectors = new bytes4[](14);
        selectors[0] = Handler.claim.selector; // claims are weighted 4x
        selectors[1] = Handler.claim.selector;
        selectors[2] = Handler.claim.selector;
        selectors[3] = Handler.claim.selector;
        selectors[4] = Handler.claimProof.selector;
        selectors[5] = Handler.transfer.selector;
        selectors[6] = Handler.warp.selector;
        selectors[7] = Handler.warp.selector;
        selectors[8] = Handler.scheduleNext.selector;
        selectors[9] = Handler.announce.selector;
        selectors[10] = Handler.proposeAdmin.selector;
        selectors[11] = Handler.acceptAdmin.selector;
        selectors[12] = Handler.cancelProposal.selector;
        selectors[13] = Handler.removeAdmin.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    /// Every token belongs to the month whose contiguous range contains it; ranges tile 1..totalMinted.
    function invariant_TokensTileMonthRanges() public view {
        uint256 next = 1;
        uint256 count = nft.monthCount();
        for (uint256 month = 1; month <= count; month++) {
            uint256 tokens = handler.recipientCount(month);
            for (uint256 k = 0; k < tokens; k++) {
                assertEq(nft.tokenData(next + k).month, month);
            }
            next += tokens;
        }
        assertEq(next - 1, nft.totalMinted());
        assertEq(nft.totalMinted(), handler.ghostMinted() + handler.ghostProofs());
    }

    /// Mined tokens of a month are numbered 1..minted; proofs carry no number and stay out of the count.
    function invariant_NumberingAndCounts() public view {
        uint256 id = 1;
        uint256 count = nft.monthCount();
        uint256 minedTotal;
        for (uint256 month = 1; month <= count; month++) {
            (,, uint32 minted,,) = nft.getMonth(month);
            uint256 tokens = handler.recipientCount(month);
            uint256 expectedNumber = 1;
            for (uint256 k = 0; k < tokens; k++) {
                ArtPoW.TokenData memory t = nft.tokenData(id++);
                if (t.edition == ArtPoW.Edition.Mined) {
                    assertEq(t.number, expectedNumber++);
                    assertGt(t.target, 0);
                } else {
                    assertEq(t.number, 0);
                }
            }
            assertEq(expectedNumber - 1, minted);
            minedTotal += minted;
        }
        assertEq(minedTotal, handler.ghostMinted());
    }

    /// Each mined recipient holds the "claimed" flag of its month, at most once (proofs are independent).
    function invariant_OneClaimPerAddressAndMonth() public view {
        uint256 count = nft.monthCount();
        for (uint256 month = 1; month <= count; month++) {
            uint256 n = handler.minedCount(month);
            for (uint256 k = 0; k < n; k++) {
                assertTrue(nft.hasClaimed(month, handler.minedRecipients(month, k)));
            }
        }
    }

    /// Every administrator went through the two-step nomination (or deployed the contract); there is always one.
    function invariant_AdminsWereAccepted() public view {
        uint256 n = nft.getRoleMemberCount(0x00);
        assertGe(n, 1);
        for (uint256 i = 0; i < n; i++) {
            address a = nft.getRoleMember(0x00, i);
            assertTrue(a == address(this) || a == address(handler) || handler.ghostAccepted(a));
        }
    }

    /// Months are ordered, never overlap, and last 25 to 35 days; the target never exceeds the floor.
    function invariant_CalendarAndTarget() public view {
        uint256 count = nft.monthCount();
        uint64 previousEnd;
        for (uint256 month = 1; month <= count; month++) {
            (uint64 start, uint64 end,,,) = nft.getMonth(month);
            assertGe(start, previousEnd);
            assertGe(end - start, 25 days);
            assertLe(end - start, 35 days);
            previousEnd = end;
        }
        uint256 active = nft.activeMonth();
        if (active != 0) assertLe(nft.currentTarget(active), nft.maxTarget());
    }
}
