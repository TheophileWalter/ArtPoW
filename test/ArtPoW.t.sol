// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ArtPoW} from "../src/ArtPoW.sol";
import {Exp2} from "../src/Exp2.sol";

/// @dev Same contract with an easy difficulty floor (64 hashes on average) so that tests can mine in the EVM.
contract Harness is ArtPoW {
    uint256 internal constant EASY_MAX_TARGET = 1 << 250;

    constructor(string memory n, string memory s, string memory d, address team) ArtPoW(n, s, d, team) {}

    function _maxTarget() internal pure override returns (uint256) {
        return EASY_MAX_TARGET;
    }

    function maxTarget() external pure returns (uint256) {
        return EASY_MAX_TARGET;
    }

    function scheduleTarget(uint256 duration, uint256 elapsed, uint256 minted) external pure returns (uint256) {
        return _scheduleTarget(duration, elapsed, minted);
    }

    function tokenJson(uint256 tokenId) external view returns (string memory) {
        return string(_tokenJson(tokenId));
    }

    function leadingZeroBits(bytes32 h) external pure returns (uint256) {
        return _leadingZeroBits(h);
    }
}

contract NoReceiver {}

/// @dev Re-enters `claim` and `claimReserved` from the ERC-721 receiver hook.
contract ReentrantReceiver is IERC721Receiver {
    ArtPoW public nft;
    address public other;
    uint256 public nonce;
    bool public armed;

    function arm(ArtPoW nft_, address other_, uint256 nonce_) external {
        (nft, other, nonce, armed) = (nft_, other_, nonce_, true);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        if (armed) {
            armed = false;
            nft.claim(1, other, nonce);
            nft.claimReserved(1, ArtPoW.Edition.TeamProof);
        }
        return IERC721Receiver.onERC721Received.selector;
    }
}

contract MockERC20 is ERC20("Mock", "MCK") {
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockERC721 is ERC721("Other", "OTH") {
    function mint(address to, uint256 id) external {
        _mint(to, id);
    }
}

contract ArtPoWTest is Test {
    event BatchMetadataUpdate(uint256 _fromTokenId, uint256 _toTokenId);
    event MonthTotalAnnounced(uint256 indexed month, uint256 total);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ContractURIUpdated();

    uint256 constant T0 = 1_800_000_000;
    uint64 constant M1_START = uint64(T0 + 1 hours);
    uint64 constant M1_END = uint64(T0 + 1 hours + 30 days);
    uint64 constant M2_END = M1_END + 30 days;
    uint256 constant DURATION = 30 days;
    uint256 constant INTERVAL = DURATION / 1000; // one token of schedule
    bytes32 constant GENESIS = bytes32(uint256(0xC0FFEE));
    bytes32 constant ADMIN = 0x00;

    Harness nft;
    uint256 MAX;
    address admin = address(this);
    address team = makeAddr("team");
    address artist = makeAddr("artist");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    uint256 nextAccount = 0x10000;

    function setUp() public {
        vm.warp(T0);
        vm.roll(100);
        vm.setBlockhash(99, GENESIS);
        nft = new Harness("Test PoW", "TPOW", "Monthly test NFT", team);
        MAX = nft.maxTarget();
        nft.scheduleMonth(1, M1_START, M1_END, mc("November 2026", "ipfs://m1"));
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    function hashOf(bytes32 seed, uint256 month, address to, uint256 nonce) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(seed, month, to, nonce)));
    }

    /// @dev First nonce whose hash lies in [lo, hi) for the given seed.
    function mineWithSeed(bytes32 seed, uint256 month, address to, uint256 lo, uint256 hi)
        internal
        pure
        returns (uint256 nonce)
    {
        for (nonce = 0;; nonce++) {
            uint256 h = hashOf(seed, month, to, nonce);
            if (h >= lo && h < hi) return nonce;
        }
    }

    function mine(uint256 month, address to, uint256 target) internal view returns (uint256) {
        return mineWithSeed(nft.monthSeed(month), month, to, 0, target);
    }

    function claimNow(uint256 month, address to) internal returns (uint256) {
        return nft.claim(month, to, mine(month, to, nft.currentTarget(month)));
    }

    function freshAccount() internal returns (address) {
        return address(uint160(nextAccount++));
    }

    function claimMany(uint256 month, uint256 count) internal {
        for (uint256 i = 0; i < count; i++) {
            claimNow(month, freshAccount());
        }
    }

    function mc(string memory label, string memory image) internal view returns (ArtPoW.MonthContent memory) {
        return
            ArtPoW.MonthContent({
                label: label, artist: "Jane Doe", artistAddress: artist, image: image, animationUrl: ""
            });
    }

    function scheduleMonth2() internal {
        nft.scheduleMonth(2, M1_END, M2_END, mc("December 2026", "ipfs://m2"));
    }

    // ---------------------------------------------------------------------
    // Difficulty schedule
    // ---------------------------------------------------------------------

    function test_TargetStartsAtFloor() public {
        vm.warp(M1_START);
        assertEq(nft.currentTarget(1), MAX);
    }

    function test_EachClaimAheadHardensByOneStep() public {
        vm.warp(M1_START);
        claimNow(1, alice);
        assertApproxEqRel(nft.currentTarget(1), MAX / 1e6 * 933_033, 2e14); // 2^(-1/10)
        claimMany(1, 9);
        assertEq(nft.currentTarget(1), MAX / 2); // 10 ahead: difficulty doubled
    }

    function test_TimeEasesBackToFloor() public {
        vm.warp(M1_START);
        claimMany(1, 10);
        vm.warp(M1_START + 5 * INTERVAL);
        assertApproxEqRel(nft.currentTarget(1), MAX / 1e6 * 707_107, 2e14); // 5 ahead: 2^(-1/2)
        vm.warp(M1_START + 10 * INTERVAL);
        assertEq(nft.currentTarget(1), MAX);
    }

    function test_BehindScheduleStaysAtFloor() public {
        vm.warp(M1_START + 15 days);
        assertEq(nft.currentTarget(1), MAX);
        claimMany(1, 20); // 500 expected by now
        assertEq(nft.currentTarget(1), MAX);
    }

    function test_BurstLimitsItself() public {
        vm.warp(M1_START);
        claimMany(1, 40);
        assertEq(nft.currentTarget(1), MAX >> 4);
    }

    /// Replaces the former epoch guarantee: a proof is judged at inclusion.
    function test_RevertWhen_ProofOutpacedByOtherClaims() public {
        vm.warp(M1_START);
        uint256 before = nft.currentTarget(1);
        uint256 afterOne = nft.scheduleTarget(DURATION, 0, 1);
        uint256 nonce = mineWithSeed(nft.monthSeed(1), 1, alice, afterOne, before);
        claimNow(1, bob);
        vm.expectRevert(ArtPoW.InsufficientWork.selector);
        nft.claim(1, alice, nonce);
    }

    function test_ProofStaysValidOverTime() public {
        vm.warp(M1_START);
        claimMany(1, 5);
        uint256 nonce = mine(1, alice, nft.currentTarget(1));
        vm.warp(M1_START + 20 days);
        nft.claim(1, alice, nonce);
    }

    function test_ScheduleFollowsActualMonthLength() public view {
        uint256[3] memory durations = [uint256(28 days), 30 days, 31 days];
        for (uint256 i = 0; i < 3; i++) {
            uint256 d = durations[i];
            assertEq(nft.scheduleTarget(d, d / 2, 500), MAX);
            assertEq(nft.scheduleTarget(d, d / 2, 510), MAX / 2);
            assertEq(nft.scheduleTarget(d, d - 1, 999), MAX);
            assertEq(nft.scheduleTarget(d, d, 1020), MAX / 4);
        }
    }

    function test_EachMonthStartsAtFloor() public {
        scheduleMonth2();
        vm.warp(M1_START);
        claimMany(1, 40);
        vm.warp(M1_END);
        assertEq(nft.currentTarget(2), MAX);
    }

    function test_RevertWhen_TargetOutsideMonth() public {
        vm.expectRevert(ArtPoW.MonthNotActive.selector);
        nft.targetAt(1, M1_START - 1);
        vm.expectRevert(ArtPoW.MonthNotActive.selector);
        nft.targetAt(1, M1_END);
        assertEq(nft.targetAt(1, M1_START), MAX);
    }

    // ---------------------------------------------------------------------
    // Seed and accumulator
    // ---------------------------------------------------------------------

    function test_ExtraClaimChangesNextSeed() public {
        scheduleMonth2();
        vm.warp(M1_START);
        claimNow(1, alice);
        bytes32 seedBefore = nft.monthSeed(2);
        claimNow(1, bob);
        assertTrue(nft.monthSeed(2) != seedBefore);
    }

    function test_FirstClaimHasNoOpeningStep() public {
        scheduleMonth2();
        vm.warp(M1_START + 1 days);
        claimNow(1, freshAccount());
        vm.warp(M1_END + 1 days);

        address a = freshAccount();
        address b = freshAccount();
        uint256 na = mine(2, a, nft.currentTarget(2));
        uint256 g0 = gasleft();
        nft.claim(2, a, na);
        uint256 first = g0 - gasleft();

        uint256 nb = mine(2, b, nft.currentTarget(2));
        g0 = gasleft();
        nft.claim(2, b, nb);
        uint256 second = g0 - gasleft();
        // Only extra cost of the first claim of a month: its accumulator slot going from zero to non-zero.
        assertLt(first, second + 25_000);
    }

    function test_MonthWithoutClaims() public {
        scheduleMonth2();
        vm.warp(M1_END);
        assertEq(nft.monthSeed(2), keccak256(abi.encode(GENESIS, uint256(1))));
        claimNow(2, alice);
    }

    function test_FirstMonthSeedFromDeployment() public {
        assertEq(nft.genesisSeed(), GENESIS);
        assertEq(nft.monthSeed(1), GENESIS);
        vm.warp(M1_START);
        claimNow(1, alice);
    }

    function test_RevertWhen_ProofFromAnotherMonthSeed() public {
        scheduleMonth2();
        vm.warp(M1_START);
        claimNow(1, bob);
        vm.warp(M1_END);
        uint256 t = nft.currentTarget(2);
        bytes32 seed1 = nft.monthSeed(1);
        bytes32 seed2 = nft.monthSeed(2);
        uint256 nonce;
        for (nonce = 0;; nonce++) {
            if (hashOf(seed1, 2, alice, nonce) < t && hashOf(seed2, 2, alice, nonce) >= t) break;
        }
        vm.expectRevert(ArtPoW.InsufficientWork.selector);
        nft.claim(2, alice, nonce);
    }

    // ---------------------------------------------------------------------
    // Calendar
    // ---------------------------------------------------------------------

    function test_MonthEndsEvenIfNextNotScheduled() public {
        vm.warp(M1_END - 1);
        uint256 nonce = mine(1, alice, nft.currentTarget(1));
        vm.warp(M1_END);
        vm.expectRevert(ArtPoW.MonthNotActive.selector);
        nft.claim(1, alice, nonce);
        vm.expectRevert(ArtPoW.UnknownMonth.selector);
        nft.claim(2, alice, nonce);

        nft.scheduleMonth(2, M1_END + 5 hours, M2_END, mc("December 2026", "ipfs://m2"));
        vm.warp(M1_END + 5 hours);
        claimNow(2, alice);
    }

    function test_NextSeedIndependentOfSchedulingDelay() public {
        vm.warp(M1_START);
        claimNow(1, alice);
        vm.warp(M1_END);
        uint256 snap = vm.snapshotState();
        nft.scheduleMonth(2, M1_END + 1 hours, M2_END, mc("December 2026", "ipfs://m2"));
        bytes32 seedEarly = nft.monthSeed(2);
        vm.revertToState(snap);

        vm.warp(M1_END + 20 days);
        nft.scheduleMonth(2, M1_END + 21 days, M2_END + 21 days, mc("December 2026", "ipfs://m2"));
        assertEq(nft.monthSeed(2), seedEarly);
    }

    function test_RevertWhen_Overlap() public {
        vm.expectRevert(ArtPoW.Overlap.selector);
        nft.scheduleMonth(2, M1_END - 1, M2_END, mc("December 2026", "ipfs://m2"));
    }

    function test_RevertWhen_OutOfOrder() public {
        vm.expectRevert(ArtPoW.MonthOutOfOrder.selector);
        nft.scheduleMonth(3, M2_END, M2_END + 30 days, mc("January 2027", "ipfs://m3"));
        vm.expectRevert(ArtPoW.MonthOutOfOrder.selector);
        nft.scheduleMonth(0, M1_END, M2_END, mc("x", "ipfs://m0"));
    }

    function test_RevertWhen_InvalidDuration() public {
        bytes4 err = ArtPoW.InvalidDuration.selector;
        vm.expectRevert(err);
        nft.scheduleMonth(2, M2_END, M2_END, mc("December 2026", "ipfs://m2"));
        vm.expectRevert(err);
        nft.scheduleMonth(2, M2_END, M1_END, mc("December 2026", "ipfs://m2"));
        vm.expectRevert(err);
        nft.scheduleMonth(2, M1_END, M1_END + 25 days - 1, mc("December 2026", "ipfs://m2"));
        vm.expectRevert(err);
        nft.scheduleMonth(2, M1_END, M1_END + 35 days + 1, mc("December 2026", "ipfs://m2"));
        vm.expectRevert(err); // a typo on an edit is caught too
        nft.scheduleMonth(1, M1_START, M1_START + 300 days, mc("November 2026", "ipfs://m1"));
    }

    function test_DurationBoundsAccepted() public {
        nft.scheduleMonth(2, M1_END, M1_END + 25 days, mc("December 2026", "ipfs://m2"));
        nft.scheduleMonth(3, M1_END + 25 days, M1_END + 60 days, mc("January 2027", "ipfs://m3"));
        assertEq(nft.monthCount(), 3);
    }

    function test_RevertWhen_EmptyLabelOrImage() public {
        vm.expectRevert(ArtPoW.EmptyContent.selector);
        nft.scheduleMonth(2, M1_END, M2_END, mc("", "ipfs://m2"));
        vm.expectRevert(ArtPoW.EmptyContent.selector);
        nft.scheduleMonth(2, M1_END, M2_END, mc("December 2026", ""));

        // Artist name, artist address and animation stay optional.
        ArtPoW.MonthContent memory c = mc("December 2026", "ipfs://m2");
        c.artist = "";
        c.artistAddress = address(0);
        nft.scheduleMonth(2, M1_END, M2_END, c);
    }

    function test_EditMonthBeforeStart() public {
        nft.scheduleMonth(1, M1_START + 1 hours, M1_END + 1 hours, mc("Nov. 2026", "ipfs://m1-v2"));
        (uint64 s, uint64 e,,, ArtPoW.MonthContent memory c) = nft.getMonth(1);
        assertEq(s, M1_START + 1 hours);
        assertEq(e, M1_END + 1 hours);
        assertEq(c.label, "Nov. 2026");
        assertEq(c.artist, "Jane Doe");
        assertEq(c.image, "ipfs://m1-v2");
        assertEq(nft.monthCount(), 1);

        // An edit cannot overlap the next month either.
        nft.scheduleMonth(2, M1_END + 1 hours, M2_END, mc("December 2026", "ipfs://m2"));
        vm.expectRevert(ArtPoW.Overlap.selector);
        nft.scheduleMonth(1, M1_START, M1_END + 2 hours, mc("November 2026", "ipfs://m1"));
    }

    function test_RevertWhen_EditStartedMonth() public {
        vm.warp(M1_START);
        vm.expectRevert(ArtPoW.MonthLocked.selector);
        nft.scheduleMonth(1, M1_START + 1 hours, M1_END, mc("November 2026", "ipfs://m1"));
        vm.expectRevert(ArtPoW.MonthLocked.selector);
        nft.scheduleMonth(1, M1_START, M1_END, mc("Other", "ipfs://m1"));
        vm.expectRevert(ArtPoW.MonthLocked.selector);
        nft.scheduleMonth(1, M1_START, M1_END, mc("November 2026", "ipfs://other"));
    }

    function test_RevertWhen_StartInPast() public {
        vm.expectRevert(ArtPoW.StartInPast.selector);
        nft.scheduleMonth(1, uint64(T0), M1_END, mc("November 2026", "ipfs://m1"));
    }

    function test_RevertWhen_ClaimBeforeStart() public {
        uint256 nonce = mine(1, alice, MAX);
        vm.expectRevert(ArtPoW.MonthNotActive.selector);
        nft.claim(1, alice, nonce);
    }

    // ---------------------------------------------------------------------
    // Claim and security
    // ---------------------------------------------------------------------

    function test_RevertWhen_DoubleClaim() public {
        vm.warp(M1_START + 1 days);
        claimNow(1, alice);
        uint256 nonce = mine(1, alice, nft.currentTarget(1));
        vm.expectRevert(ArtPoW.AlreadyClaimed.selector);
        nft.claim(1, alice, nonce);
    }

    function test_ClaimTwoMonths() public {
        scheduleMonth2();
        vm.warp(M1_START);
        claimNow(1, alice);
        vm.warp(M1_END);
        claimNow(2, alice);
        assertEq(nft.balanceOf(alice), 2);
    }

    function test_ProofCannotBeStolen() public {
        vm.warp(M1_START);
        uint256 t = nft.currentTarget(1);
        bytes32 seed = nft.monthSeed(1);
        uint256 nonce;
        for (nonce = 0;; nonce++) {
            if (hashOf(seed, 1, alice, nonce) < t && hashOf(seed, 1, bob, nonce) >= t) break;
        }
        vm.prank(bob);
        vm.expectRevert(ArtPoW.InsufficientWork.selector);
        nft.claim(1, bob, nonce);

        vm.prank(bob);
        uint256 id = nft.claim(1, alice, nonce);
        assertEq(nft.ownerOf(id), alice);
    }

    function test_ThirdPartySubmission() public {
        vm.warp(M1_START);
        uint256 nonce = mine(1, alice, nft.currentTarget(1));
        vm.prank(makeAddr("submitter"));
        uint256 id = nft.claim(1, alice, nonce);
        assertEq(nft.ownerOf(id), alice);
    }

    function test_RevertWhen_ClaimAgainAfterTransfer() public {
        vm.warp(M1_START + 1 days);
        uint256 id = claimNow(1, alice);
        vm.prank(alice);
        nft.transferFrom(alice, bob, id);
        uint256 nonce = mine(1, alice, nft.currentTarget(1));
        vm.expectRevert(ArtPoW.AlreadyClaimed.selector);
        nft.claim(1, alice, nonce);
    }

    /// Regression (security review): re-entering from the receiver hook keeps counters, numbers and ids consistent.
    function test_ReentrancyKeepsStateConsistent() public {
        vm.warp(M1_START);
        ReentrantReceiver r = new ReentrantReceiver();
        address other = freshAccount();
        uint256 nested = mine(1, other, nft.scheduleTarget(DURATION, 0, 1)); // target after one more token
        r.arm(nft, other, nested);
        nft.claim(1, address(r), mine(1, address(r), nft.currentTarget(1)));

        (,, uint32 minted,,) = nft.getMonth(1);
        assertEq(minted, 2);
        assertEq(nft.totalMinted(), 3);
        assertEq(nft.ownerOf(1), address(r));
        assertEq(nft.ownerOf(2), other);
        assertEq(nft.ownerOf(3), team);
        assertEq(nft.tokenData(1).number, 1);
        assertEq(nft.tokenData(2).number, 2);
    }

    function test_RevertWhen_RecipientCannotReceive() public {
        vm.warp(M1_START);
        address sink = address(new NoReceiver());
        uint256 nonce = mine(1, sink, nft.currentTarget(1));
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721InvalidReceiver.selector, sink));
        nft.claim(1, sink, nonce);
    }

    // ---------------------------------------------------------------------
    // Administration and shutdown
    // ---------------------------------------------------------------------

    event AdminProposed(address indexed account, address indexed by);
    event AdminProposalCancelled(address indexed account, address indexed by);

    /// @dev Two-step nomination: proposed by an administrator, accepted by the account itself.
    function addAdmin(address account) internal {
        nft.proposeAdmin(account);
        vm.prank(account);
        nft.acceptAdmin();
    }

    function test_ProposeAndAcceptAdmin() public {
        vm.expectEmit(address(nft));
        emit AdminProposed(alice, admin);
        nft.proposeAdmin(alice);
        assertTrue(nft.isProposedAdmin(alice));

        // Not an administrator before accepting.
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, ADMIN));
        scheduleMonth2();

        vm.prank(alice);
        nft.acceptAdmin();
        assertTrue(nft.hasRole(ADMIN, alice));
        assertFalse(nft.isProposedAdmin(alice));
        vm.prank(alice);
        scheduleMonth2();
        assertEq(nft.monthCount(), 2);
    }

    function test_RevertWhen_GrantingAdminDirectly() public {
        vm.expectRevert(ArtPoW.UseAdminProposal.selector);
        nft.grantRole(ADMIN, alice);
        assertFalse(nft.hasRole(ADMIN, alice));
    }

    function test_RevertWhen_AcceptingWithoutProposal() public {
        vm.prank(alice);
        vm.expectRevert(ArtPoW.NotProposed.selector);
        nft.acceptAdmin();
    }

    function test_CancelAdminProposal() public {
        nft.proposeAdmin(alice);
        vm.expectEmit(address(nft));
        emit AdminProposalCancelled(alice, admin);
        nft.cancelAdminProposal(alice);
        vm.prank(alice);
        vm.expectRevert(ArtPoW.NotProposed.selector);
        nft.acceptAdmin();
        vm.expectRevert(ArtPoW.NotProposed.selector);
        nft.cancelAdminProposal(alice);
    }

    function test_RevertWhen_ProposingExistingAdmin() public {
        vm.expectRevert(ArtPoW.AlreadyAdmin.selector);
        nft.proposeAdmin(admin);
    }

    /// Regression (security review): an address nobody controls can no longer become an administrator, so the
    /// last real administrator cannot leave the contract without administration.
    function test_UncontrolledAddressCannotBecomeAdmin() public {
        nft.proposeAdmin(address(0)); // nobody can ever accept on its behalf
        assertEq(nft.getRoleMemberCount(ADMIN), 1);
        vm.expectRevert(ArtPoW.LastAdmin.selector);
        nft.renounceRole(ADMIN, admin);
    }

    function test_RevokeAdmin() public {
        addAdmin(alice);
        vm.prank(alice);
        nft.revokeRole(ADMIN, admin);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, admin, ADMIN));
        scheduleMonth2();
    }

    function test_RevertWhen_RemovingLastAdmin() public {
        vm.expectRevert(ArtPoW.LastAdmin.selector);
        nft.revokeRole(ADMIN, admin);
        vm.expectRevert(ArtPoW.LastAdmin.selector);
        nft.renounceRole(ADMIN, admin);

        addAdmin(alice);
        nft.renounceRole(ADMIN, admin);
        vm.prank(alice);
        vm.expectRevert(ArtPoW.LastAdmin.selector);
        nft.renounceRole(ADMIN, alice);
    }

    function test_RevertWhen_NotAdmin() public {
        bytes memory err = abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, bob, ADMIN);
        vm.startPrank(bob);
        vm.expectRevert(err);
        scheduleMonth2();
        vm.expectRevert(err);
        nft.setTeamRecipient(bob);
        vm.expectRevert(err);
        nft.setOwner(bob);
        vm.expectRevert(err);
        nft.setCollectionInfo("ipfs://logo", "https://example.org");
        vm.expectRevert(err);
        nft.proposeAdmin(bob);
        vm.expectRevert(err);
        nft.cancelAdminProposal(bob);
        vm.expectRevert(err);
        nft.shutdown();
        vm.stopPrank();
    }

    function test_ShutdownStopsClaimsAndScheduling() public {
        vm.warp(M1_START);
        uint256 nonce = mine(1, alice, nft.currentTarget(1));
        nft.shutdown();
        vm.expectRevert(ArtPoW.ContractShutDown.selector);
        nft.claim(1, alice, nonce);
        vm.expectRevert(ArtPoW.ContractShutDown.selector);
        scheduleMonth2();
    }

    function test_ShutdownIsFinal() public {
        nft.shutdown();
        vm.expectRevert(ArtPoW.ContractShutDown.selector);
        nft.shutdown();
        assertTrue(nft.isShutDown());
    }

    function test_ShutdownKeepsHoldersUnaffected() public {
        vm.warp(M1_START);
        uint256 id = claimNow(1, alice);
        nft.shutdown();

        vm.prank(alice);
        nft.approve(bob, id);
        vm.prank(bob);
        nft.transferFrom(alice, bob, id);
        assertEq(nft.ownerOf(id), bob);
        assertGt(bytes(nft.tokenURI(id)).length, 0);
        vm.expectRevert(ArtPoW.ContractShutDown.selector);
        nft.claimReserved(1, ArtPoW.Edition.ArtistProof);

        // The running month is closed for good: its total is final and can be announced.
        (,,, bool closed,) = nft.getMonth(1);
        assertTrue(closed);
        nft.announceMonthTotal(1);
    }

    // ---------------------------------------------------------------------
    // NFT and metadata
    // ---------------------------------------------------------------------

    function test_StandardTransfers() public {
        vm.warp(M1_START);
        uint256 id = claimNow(1, alice);
        vm.prank(alice);
        nft.setApprovalForAll(bob, true);
        vm.prank(bob);
        nft.safeTransferFrom(alice, bob, id);
        assertEq(nft.ownerOf(id), bob);
        assertTrue(nft.supportsInterface(0x80ac58cd)); // ERC-721
        assertTrue(nft.supportsInterface(0x5b5e139f)); // ERC-721 metadata
        assertFalse(nft.supportsInterface(0x2a55205a)); // no ERC-2981 royalties
        assertTrue(nft.supportsInterface(0x49064906)); // ERC-4906
    }

    function expectedJson(uint256 number, uint256 total, uint256 target, uint256 zeroBits)
        internal
        pure
        returns (string memory)
    {
        bool closed = total > 0;
        return string.concat(
            string.concat(
                unicode'{"name":"November 2026 • #',
                vm.toString(number),
                closed ? string.concat(" / ", vm.toString(total)) : "",
                '","description":"Monthly test NFT","image":"ipfs://m1","attributes":[',
                '{"trait_type":"Month","value":"November 2026"},',
                '{"trait_type":"Artist","value":"Jane Doe"},',
                '{"trait_type":"Edition","value":"Mined"},',
                '{"trait_type":"Number","display_type":"number","value":',
                vm.toString(number),
                "},"
            ),
            closed
                ? string.concat('{"trait_type":"Total","display_type":"number","value":', vm.toString(total), "},")
                : "",
            '{"trait_type":"Difficulty","display_type":"number","value":',
            vm.toString(type(uint256).max / target),
            '},{"trait_type":"Leading zero bits","display_type":"number","value":',
            vm.toString(zeroBits),
            "}]}"
        );
    }

    function test_OnChainMetadataWhileOpen() public {
        vm.warp(M1_START + 1 days);
        uint256 id1 = claimNow(1, alice);
        uint256 t = nft.currentTarget(1);
        uint256 id2 = claimNow(1, bob);

        ArtPoW.TokenData memory d = nft.tokenData(id2);
        assertEq(d.month, 1);
        assertEq(d.number, 2);
        assertEq(d.target, t);

        string memory json = expectedJson(2, 0, t, d.leadingZeroBits);
        assertEq(nft.tokenURI(id2), string.concat("data:application/json;base64,", vm.toBase64(json)));
        assertEq(vm.parseJsonUint(json, ".attributes[3].value"), 2);
        assertEq(vm.parseJsonString(json, ".attributes[1].value"), "Jane Doe");
        assertEq(vm.parseJsonString(json, ".image"), "ipfs://m1");
        assertTrue(keccak256(bytes(nft.tokenURI(id1))) != keccak256(bytes(nft.tokenURI(id2))));

        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, 99));
        nft.tokenURI(99);
    }

    function test_OnChainMetadataShowsTotalOnceClosed() public {
        vm.warp(M1_START + 1 days);
        claimNow(1, alice);
        uint256 t = nft.currentTarget(1);
        uint256 id = claimNow(1, bob);
        claimNow(1, freshAccount());

        vm.warp(M1_END);
        string memory json = expectedJson(2, 3, t, nft.tokenData(id).leadingZeroBits);
        assertEq(nft.tokenURI(id), string.concat("data:application/json;base64,", vm.toBase64(json)));
        assertEq(vm.parseJsonString(json, ".name"), unicode"November 2026 • #2 / 3");
        assertEq(vm.parseJsonUint(json, ".attributes[4].value"), 3);
    }

    function test_AnnounceMonthTotal() public {
        scheduleMonth2();
        vm.warp(M1_START + 1 days);
        claimMany(1, 3); // tokens 1..3
        vm.warp(M1_END + 1 days);
        claimMany(2, 2); // tokens 4..5

        vm.expectRevert(ArtPoW.MonthNotClosed.selector);
        nft.announceMonthTotal(2);

        vm.expectEmit(address(nft));
        emit MonthTotalAnnounced(1, 3);
        vm.expectEmit(address(nft));
        emit BatchMetadataUpdate(1, 3);
        vm.prank(makeAddr("anyone"));
        nft.announceMonthTotal(1);

        vm.expectRevert(ArtPoW.AlreadyAnnounced.selector);
        nft.announceMonthTotal(1);

        vm.warp(M2_END);
        vm.expectEmit(address(nft));
        emit BatchMetadataUpdate(4, 5);
        nft.announceMonthTotal(2);
    }

    function test_AnnounceEmptyMonth() public {
        vm.warp(M1_END);
        vm.recordLogs();
        nft.announceMonthTotal(1);
        assertEq(vm.getRecordedLogs().length, 1); // MonthTotalAnnounced only
    }

    function test_RevertWhen_UnsafeStrings() public {
        vm.expectRevert(ArtPoW.UnsafeString.selector);
        nft.scheduleMonth(2, M1_END, M2_END, mc("December 2026", 'ipfs://x","name":"fake'));
        vm.expectRevert(ArtPoW.UnsafeString.selector);
        nft.scheduleMonth(2, M1_END, M2_END, mc("December 2026", "ipfs://x\n"));
        vm.expectRevert(ArtPoW.UnsafeString.selector);
        nft.scheduleMonth(2, M1_END, M2_END, mc('Dec"', "ipfs://m2"));
    }

    function test_RevertWhen_UnsafeArtistOrAnimation() public {
        ArtPoW.MonthContent memory c = mc("December 2026", "ipfs://m2");
        c.artist = 'Jane "JD" Doe';
        vm.expectRevert(ArtPoW.UnsafeString.selector);
        nft.scheduleMonth(2, M1_END, M2_END, c);
        c.artist = "Jane Doe";
        c.animationUrl = "ipfs://anim\\x";
        vm.expectRevert(ArtPoW.UnsafeString.selector);
        nft.scheduleMonth(2, M1_END, M2_END, c);
    }

    function test_AnimationUrlOnlyWhenSet() public {
        ArtPoW.MonthContent memory c = mc("December 2026", "ipfs://preview");
        c.animationUrl = "ipfs://video";
        nft.scheduleMonth(2, M1_END, M2_END, c);
        vm.warp(M1_START);
        uint256 id1 = claimNow(1, alice);
        vm.warp(M1_END);
        uint256 id2 = claimNow(2, alice);

        assertFalse(vm.keyExistsJson(nft.tokenJson(id1), ".animation_url"));
        string memory json2 = nft.tokenJson(id2);
        assertEq(vm.parseJsonString(json2, ".animation_url"), "ipfs://video");
        assertEq(vm.parseJsonString(json2, ".image"), "ipfs://preview");
        assertEq(nft.tokenURI(id2), string.concat("data:application/json;base64,", vm.toBase64(json2)));
    }

    function test_NumberingRestartsEachMonth() public {
        scheduleMonth2();
        vm.warp(M1_START);
        claimNow(1, alice);
        nft.claimReserved(1, ArtPoW.Edition.ArtistProof);
        nft.claimReserved(1, ArtPoW.Edition.TeamProof);
        claimNow(1, bob);
        vm.warp(M1_END);
        // Proofs of the new month come first: they take token ids but not edition numbers.
        nft.claimReserved(2, ArtPoW.Edition.ArtistProof);
        uint256 id = claimNow(2, alice);
        assertEq(id, 6);
        assertEq(nft.tokenData(id).number, 1);
        assertEq(vm.parseJsonString(nft.tokenJson(id), ".name"), unicode"December 2026 • #1");
        assertEq(vm.parseJsonString(nft.tokenJson(4), ".name"), unicode"November 2026 • #2 / 2");
        uint256 id2 = claimNow(2, bob);
        assertEq(vm.parseJsonString(nft.tokenJson(id2), ".name"), unicode"December 2026 • #2");
    }

    function test_LeadingZeroBits() public view {
        assertEq(nft.leadingZeroBits(bytes32(type(uint256).max)), 0);
        assertEq(nft.leadingZeroBits(bytes32(uint256(1) << 255)), 0); // 0x80...
        assertEq(nft.leadingZeroBits(bytes32(uint256(1) << 248)), 7); // 0x01...
        assertEq(nft.leadingZeroBits(bytes32(uint256(1) << 247)), 8); // 0x00 80...
        assertEq(nft.leadingZeroBits(bytes32(uint256(1))), 255);
        assertEq(nft.leadingZeroBits(bytes32(0)), 256);
    }

    function test_MintedHashMeetsTargetAndZeroBits() public {
        vm.warp(M1_START);
        uint256 id = claimNow(1, alice);
        // Easy floor 2^250: every valid hash has at least 6 leading zero bits.
        assertGe(nft.tokenData(id).leadingZeroBits, 6);
    }

    // ---------------------------------------------------------------------
    // Artist and team proofs
    // ---------------------------------------------------------------------

    function test_ProofsMintedByAnyoneToTheirRecipients() public {
        vm.warp(M1_START);
        vm.startPrank(makeAddr("anyone"));
        uint256 a = nft.claimReserved(1, ArtPoW.Edition.ArtistProof);
        uint256 t = nft.claimReserved(1, ArtPoW.Edition.TeamProof);
        vm.stopPrank();
        assertEq(nft.ownerOf(a), artist);
        assertEq(nft.ownerOf(t), team);
        (bool artistProof, bool teamProof) = nft.proofsMinted(1);
        assertTrue(artistProof && teamProof);
    }

    function test_RevertWhen_ProofMintedTwice() public {
        vm.warp(M1_START);
        nft.claimReserved(1, ArtPoW.Edition.ArtistProof);
        vm.expectRevert(ArtPoW.ProofAlreadyMinted.selector);
        nft.claimReserved(1, ArtPoW.Edition.ArtistProof);
        nft.claimReserved(1, ArtPoW.Edition.TeamProof);
        vm.expectRevert(ArtPoW.ProofAlreadyMinted.selector);
        nft.claimReserved(1, ArtPoW.Edition.TeamProof);
    }

    function test_RevertWhen_ProofMisused() public {
        vm.expectRevert(ArtPoW.MonthNotActive.selector);
        nft.claimReserved(1, ArtPoW.Edition.ArtistProof); // before the start
        vm.warp(M1_START);
        vm.expectRevert(ArtPoW.NotAProof.selector);
        nft.claimReserved(1, ArtPoW.Edition.Mined);
        vm.warp(M1_END);
        vm.expectRevert(ArtPoW.MonthNotActive.selector);
        nft.claimReserved(1, ArtPoW.Edition.TeamProof); // after the end
    }

    function test_RevertWhen_NoProofRecipient() public {
        ArtPoW.MonthContent memory c = mc("December 2026", "ipfs://m2");
        c.artistAddress = address(0);
        nft.scheduleMonth(2, M1_END, M2_END, c);
        nft.setTeamRecipient(address(0));
        vm.warp(M1_END);
        vm.expectRevert(ArtPoW.NoRecipient.selector);
        nft.claimReserved(2, ArtPoW.Edition.ArtistProof);
        vm.expectRevert(ArtPoW.NoRecipient.selector);
        nft.claimReserved(2, ArtPoW.Edition.TeamProof);
    }

    function test_ProofIndependentOfRecipientClaim() public {
        vm.warp(M1_START);
        nft.claimReserved(1, ArtPoW.Edition.ArtistProof);
        claimNow(1, artist); // the artist may also mine a regular token
        assertEq(nft.balanceOf(artist), 2);

        claimNow(1, team); // a mined claim does not prevent the team proof
        nft.claimReserved(1, ArtPoW.Edition.TeamProof);
        assertEq(nft.balanceOf(team), 2);
    }

    /// Regression (security review): a third party mining on behalf of a proof recipient cannot block its proof.
    function test_ProofCannotBeGriefedByThirdPartyClaim() public {
        vm.warp(M1_START);
        address griefer = makeAddr("griefer");
        uint256 forArtist = mine(1, artist, nft.currentTarget(1));
        vm.prank(griefer);
        nft.claim(1, artist, forArtist);
        uint256 forTeam = mine(1, team, nft.currentTarget(1));
        vm.prank(griefer);
        nft.claim(1, team, forTeam);

        uint256 a = nft.claimReserved(1, ArtPoW.Edition.ArtistProof);
        uint256 t = nft.claimReserved(1, ArtPoW.Edition.TeamProof);
        assertEq(nft.ownerOf(a), artist);
        assertEq(nft.ownerOf(t), team);
    }

    function test_ProofsStayOutOfScheduleNumberingAndSeed() public {
        scheduleMonth2();
        vm.warp(M1_START);
        bytes32 seed2 = nft.monthSeed(2);
        nft.claimReserved(1, ArtPoW.Edition.ArtistProof);
        nft.claimReserved(1, ArtPoW.Edition.TeamProof);
        assertEq(nft.currentTarget(1), MAX); // schedule untouched
        assertEq(nft.monthSeed(2), seed2); // accumulator untouched
        uint256 id = claimNow(1, alice);
        assertEq(nft.tokenData(id).number, 1);
        (,, uint32 minted,,) = nft.getMonth(1);
        assertEq(minted, 1);
    }

    function test_TeamRecipientUpdate() public {
        nft.setTeamRecipient(bob);
        assertEq(nft.teamRecipient(), bob);
        vm.warp(M1_START);
        uint256 id = nft.claimReserved(1, ArtPoW.Edition.TeamProof);
        assertEq(nft.ownerOf(id), bob);
    }

    function test_ProofMetadata() public {
        vm.warp(M1_START);
        claimNow(1, alice);
        uint256 a = nft.claimReserved(1, ArtPoW.Edition.ArtistProof);
        uint256 t = nft.claimReserved(1, ArtPoW.Edition.TeamProof);

        string memory json = nft.tokenJson(a);
        assertEq(vm.parseJsonString(json, ".name"), unicode"November 2026 • Artist proof");
        assertEq(vm.parseJsonString(json, ".attributes[2].value"), "Artist proof");
        assertFalse(vm.keyExistsJson(json, ".attributes[3]")); // no number, difficulty nor zero bits
        assertEq(vm.parseJsonString(nft.tokenJson(t), ".name"), unicode"November 2026 • Team proof");

        vm.warp(M1_END);
        json = nft.tokenJson(a);
        assertEq(vm.parseJsonString(json, ".attributes[3].trait_type"), "Total");
        assertEq(vm.parseJsonUint(json, ".attributes[3].value"), 1); // proofs are not counted
        assertFalse(vm.keyExistsJson(json, ".attributes[4]"));
    }

    function test_AnnounceCoversProofs() public {
        scheduleMonth2();
        vm.warp(M1_START);
        nft.claimReserved(1, ArtPoW.Edition.ArtistProof); // token 1
        claimMany(1, 2); // tokens 2..3
        nft.claimReserved(1, ArtPoW.Edition.TeamProof); // token 4
        vm.warp(M1_END);
        claimNow(2, alice); // token 5

        vm.expectEmit(address(nft));
        emit MonthTotalAnnounced(1, 2);
        vm.expectEmit(address(nft));
        emit BatchMetadataUpdate(1, 4);
        nft.announceMonthTotal(1);
    }

    // ---------------------------------------------------------------------
    // Collection metadata, owner and active month
    // ---------------------------------------------------------------------

    function test_OwnerIsSetByAdminsAndGrantsNoRight() public {
        assertEq(nft.owner(), admin);
        vm.expectEmit(address(nft));
        emit OwnershipTransferred(admin, bob);
        nft.setOwner(bob);
        assertEq(nft.owner(), bob);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, bob, ADMIN));
        scheduleMonth2();
    }

    function test_ContractURI() public {
        string memory prefix = "data:application/json;base64,";
        assertEq(
            nft.contractURI(),
            string.concat(prefix, vm.toBase64(string('{"name":"Test PoW","description":"Monthly test NFT"}')))
        );

        vm.expectEmit(address(nft));
        emit ContractURIUpdated();
        nft.setCollectionInfo("ipfs://logo", "https://example.org");
        string memory json = '{"name":"Test PoW","description":"Monthly test NFT","image":"ipfs://logo",'
            '"external_link":"https://example.org"}';
        assertEq(nft.contractURI(), string.concat(prefix, vm.toBase64(json)));
        assertEq(vm.parseJsonString(json, ".external_link"), "https://example.org");
    }

    function test_ExternalUrlFollowsSiteUrl() public {
        vm.warp(M1_START);
        uint256 id = claimNow(1, alice);
        assertFalse(vm.keyExistsJson(nft.tokenJson(id), ".external_url"));

        vm.expectEmit(address(nft));
        emit BatchMetadataUpdate(1, 1); // every token's metadata changed
        nft.setCollectionInfo("", "https://example.org");
        assertEq(vm.parseJsonString(nft.tokenJson(id), ".external_url"), "https://example.org/token/1");
    }

    function test_RevertWhen_UnsafeCollectionInfo() public {
        vm.expectRevert(ArtPoW.UnsafeString.selector);
        nft.setCollectionInfo('ipfs://x"', "https://example.org");
        vm.expectRevert(ArtPoW.UnsafeString.selector);
        nft.setCollectionInfo("ipfs://logo", "https://example.org\n");
    }

    function test_ActiveMonth() public {
        nft.scheduleMonth(2, M1_END + 1 days, M2_END, mc("December 2026", "ipfs://m2"));
        assertEq(nft.activeMonth(), 0); // before the first month
        vm.warp(M1_START);
        assertEq(nft.activeMonth(), 1);
        vm.warp(M1_END - 1);
        assertEq(nft.activeMonth(), 1);
        vm.warp(M1_END); // gap between months
        assertEq(nft.activeMonth(), 0);
        vm.warp(M1_END + 1 days);
        assertEq(nft.activeMonth(), 2);
        vm.warp(M2_END);
        assertEq(nft.activeMonth(), 0);
    }

    // ---------------------------------------------------------------------
    // Rescue of assets sent by mistake
    // ---------------------------------------------------------------------

    function test_PlainNativeTransferRejected() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(nft).call{value: 1 ether}("");
        assertFalse(ok);
    }

    function test_RescueNative() public {
        vm.deal(address(nft), 1 ether); // as a forced transfer would
        nft.rescueNative(payable(bob), 0.4 ether);
        assertEq(bob.balance, 0.4 ether);
        assertEq(address(nft).balance, 0.6 ether);
    }

    function test_RescueERC20() public {
        MockERC20 token = new MockERC20();
        token.mint(address(nft), 100);
        nft.rescueERC20(IERC20(address(token)), bob, 100);
        assertEq(token.balanceOf(bob), 100);
    }

    function test_RescueOtherERC721() public {
        MockERC721 other = new MockERC721();
        other.mint(address(nft), 7);
        nft.rescueERC721(IERC721(address(other)), 7, bob);
        assertEq(other.ownerOf(7), bob);
    }

    function test_RevertWhen_RescuingOwnToken() public {
        vm.warp(M1_START);
        uint256 id = claimNow(1, alice);
        vm.prank(alice);
        nft.transferFrom(alice, address(nft), id); // sent by mistake: stays there for good
        vm.expectRevert(ArtPoW.CannotRescueOwnTokens.selector);
        nft.rescueERC721(IERC721(address(nft)), id, alice);
        assertEq(nft.ownerOf(id), address(nft));
    }

    function test_RevertWhen_RescueByNonAdmin() public {
        bytes memory err = abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, bob, ADMIN);
        vm.deal(address(nft), 1 ether);
        vm.startPrank(bob);
        vm.expectRevert(err);
        nft.rescueNative(payable(bob), 1 ether);
        vm.expectRevert(err);
        nft.rescueERC20(IERC20(address(1)), bob, 1);
        vm.expectRevert(err);
        nft.rescueERC721(IERC721(address(1)), 1, bob);
        vm.stopPrank();
    }

    function test_RescueWorksAfterShutdown() public {
        nft.shutdown();
        vm.deal(address(nft), 1 ether);
        nft.rescueNative(payable(bob), 1 ether);
        assertEq(bob.balance, 1 ether);
    }

    // ---------------------------------------------------------------------
    // Exp2
    // ---------------------------------------------------------------------

    function test_Exp2ExactPowers() public pure {
        uint256 x = 1 << 200;
        uint256 cap = type(uint256).max >> 1;
        assertEq(Exp2.mulExp2(x, 43200, 43200, cap), x * 2);
        assertEq(Exp2.mulExp2(x, -86400, 43200, cap), x / 4);
        assertEq(Exp2.mulExp2(x, 0, 43200, cap), x);
        assertApproxEqRel(Exp2.mulExp2(1e30, 21600, 43200, cap), 1414213562373095e15, 2e14); // 2^0.5
    }

    function testFuzz_Exp2Monotonic(int256 a, int256 b, uint128 x) public pure {
        a = bound(a, -1e9, 1e9);
        b = bound(b, -1e9, 1e9);
        if (a > b) (a, b) = (b, a);
        uint256 cap = 1 << 250;
        uint256 v = bound(uint256(x), 1, cap);
        assertLe(Exp2.mulExp2(v, a, 43200, cap), Exp2.mulExp2(v, b, 43200, cap));
        assertLe(Exp2.mulExp2(v, b, 43200, cap), cap);
        assertGe(Exp2.mulExp2(v, a, 43200, cap), 1);
    }

    function testFuzz_ScheduleTargetMonotonic(uint32 elapsed, uint16 minted) public view {
        uint256 e = bound(uint256(elapsed), 0, DURATION - 2);
        uint256 t = nft.scheduleTarget(DURATION, e, minted);
        assertLe(t, MAX);
        assertGe(nft.scheduleTarget(DURATION, e + 1, minted), t); // time eases
        assertLe(nft.scheduleTarget(DURATION, e, uint256(minted) + 1), t); // claims harden
    }
}
