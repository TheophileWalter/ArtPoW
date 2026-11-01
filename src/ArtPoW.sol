// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {AccessControl, IAccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {AccessControlEnumerable} from "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";
import {IERC4906} from "@openzeppelin/contracts/interfaces/IERC4906.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Exp2} from "./Exp2.sol";

/// @title Monthly free NFT, claimed with proof of work
/// @notice During a scheduled month, any address may claim one token by submitting a nonce such that
/// `keccak256(abi.encode(seed, month, recipient, nonce)) < target`.
/// The target follows a linear schedule of `SUPPLY_PER_MONTH` tokens over the month: every token minted ahead
/// of schedule makes the next one 2^(1 / CLAIMS_PER_DOUBLING) harder, and time eases it back to the floor.
/// The seed of month M+1 is an accumulator of every claim of month M.
/// Besides mined tokens, each month may have one artist proof and one team proof, minted without work and kept
/// out of the numbering, the total and the difficulty schedule. There are no royalties.
contract ArtPoW is ERC721, AccessControlEnumerable, IERC4906 {
    using Strings for uint256;
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Constants (frozen: the contract is not upgradable)
    // ---------------------------------------------------------------------

    /// @notice Number of tokens the difficulty schedule aims at over a month. Not a cap.
    uint256 public constant SUPPLY_PER_MONTH = 1000;
    /// @notice Being this many tokens ahead of schedule doubles the difficulty.
    uint256 public constant CLAIMS_PER_DOUBLING = 10;
    /// @notice Log2 of the expected number of hashes at the difficulty floor.
    uint256 public constant FLOOR_DIFFICULTY_BITS = 28;
    /// @notice Bounds of a month's duration, guarding against typos that would become final at its start.
    uint256 public constant MIN_MONTH_DURATION = 25 days;
    uint256 public constant MAX_MONTH_DURATION = 35 days;
    /// @notice Easiest possible target (difficulty floor).
    uint256 public constant MAX_TARGET = 1 << (256 - FLOOR_DIFFICULTY_BITS);

    // ---------------------------------------------------------------------
    // Types and storage
    // ---------------------------------------------------------------------

    enum Edition {
        Mined,
        ArtistProof,
        TeamProof
    }

    struct Month {
        uint64 start;
        uint64 end;
        uint32 minted; // mined tokens only: proofs are out of the numbering, the total and the schedule
        uint64 firstTokenId; // tokens of a month are contiguous: months never overlap
        bool totalAnnounced;
        bool artistProofMinted;
        bool teamProofMinted;
        bytes32 accumulator; // zero until the first mined claim
        MonthContent content;
    }

    /// @notice Content of a month. Strings are embedded verbatim in the JSON metadata.
    struct MonthContent {
        string label; // e.g. "November 2026"
        string artist;
        address artistAddress; // receives the artist proof; zero for none
        string image; // URI of the artwork, square ratio (e.g. "ipfs://<CID>")
        string animationUrl; // optional (video, 3D, HTML); `image` then serves as the preview
    }

    struct TokenData {
        uint32 month;
        uint32 number; // zero for proofs
        uint16 leadingZeroBits; // zero for proofs
        Edition edition;
        uint256 target; // zero for proofs
    }

    /// @notice Seed of month 1, fixed at deployment.
    bytes32 public immutable genesisSeed;
    string private _description;

    uint256 public monthCount;
    mapping(uint256 month => Month) private _months;
    mapping(uint256 month => mapping(address account => bool)) public hasClaimed;

    uint256 public totalMinted;
    mapping(uint256 tokenId => TokenData) private _tokens;

    bool public isShutDown;
    /// @notice Receives the team proof of each month; zero for none. Settable by administrators.
    address public teamRecipient;
    /// @notice Collection logo and website, shown by marketplaces. Settable by administrators.
    string public collectionImage;
    string public siteUrl;
    address private _owner;
    /// @notice Addresses proposed as administrators, waiting for their own acceptance.
    mapping(address account => bool) public isProposedAdmin;

    // ---------------------------------------------------------------------
    // Events and errors
    // ---------------------------------------------------------------------

    event MonthScheduled(uint256 indexed month, uint64 start, uint64 end);
    event Claimed(
        uint256 indexed tokenId, uint256 indexed month, address indexed recipient, uint256 number, bytes32 hash
    );
    event MonthTotalAnnounced(uint256 indexed month, uint256 total);
    event ProofClaimed(uint256 indexed tokenId, uint256 indexed month, address indexed recipient, Edition edition);
    event TeamRecipientUpdated(address recipient);
    /// @dev ERC-173 event, emitted when the address returned by `owner()` changes.
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    /// @dev ERC-7572 event, emitted when the collection metadata changes.
    event ContractURIUpdated();
    event Rescued(address indexed asset, address indexed to, uint256 amountOrId);
    event ShutDown(address indexed by);
    event AdminProposed(address indexed account, address indexed by);
    event AdminProposalCancelled(address indexed account, address indexed by);

    error ContractShutDown();
    error UnknownMonth();
    error MonthOutOfOrder();
    error MonthLocked();
    error InvalidDuration();
    error EmptyContent();
    error StartInPast();
    error Overlap();
    error UnsafeString();
    error MonthNotActive();
    error MonthNotClosed();
    error AlreadyAnnounced();
    error AlreadyClaimed();
    error InsufficientWork();
    error NotAProof();
    error ProofAlreadyMinted();
    error NoRecipient();
    error LastAdmin();
    error CannotRescueOwnTokens();
    error UseAdminProposal();
    error NotProposed();
    error AlreadyAdmin();

    modifier notShutDown() {
        if (isShutDown) revert ContractShutDown();
        _;
    }

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    constructor(string memory name_, string memory symbol_, string memory description_, address teamRecipient_)
        ERC721(name_, symbol_)
    {
        _checkJsonSafe(name_);
        _checkJsonSafe(description_);
        _description = description_;
        genesisSeed = blockhash(block.number - 1);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _setTeamRecipient(teamRecipient_);
        _setOwner(msg.sender);
    }

    // ---------------------------------------------------------------------
    // Administration
    // ---------------------------------------------------------------------

    /// @notice Schedules a new month (`month == monthCount + 1`) or edits a month that has not started.
    /// @dev Months last 25 to 35 days, may not overlap, need a label and an image, and are locked (dates and
    /// content) once started.
    function scheduleMonth(uint256 month, uint64 start, uint64 end, MonthContent calldata content)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        notShutDown
    {
        if (month == 0 || month > monthCount + 1) revert MonthOutOfOrder();
        if (month <= monthCount && block.timestamp >= _months[month].start) revert MonthLocked();
        if (end <= start || end - start < MIN_MONTH_DURATION || end - start > MAX_MONTH_DURATION) {
            revert InvalidDuration();
        }
        if (start <= block.timestamp) revert StartInPast();
        if (month > 1 && start < _months[month - 1].end) revert Overlap();
        if (month < monthCount && end > _months[month + 1].start) revert Overlap();
        if (bytes(content.label).length == 0 || bytes(content.image).length == 0) revert EmptyContent();
        _checkJsonSafe(content.label);
        _checkJsonSafe(content.artist);
        _checkJsonSafe(content.image);
        _checkJsonSafe(content.animationUrl);

        Month storage m = _months[month];
        m.start = start;
        m.end = end;
        m.content.label = content.label;
        m.content.artist = content.artist;
        m.content.artistAddress = content.artistAddress;
        m.content.image = content.image;
        m.content.animationUrl = content.animationUrl;
        if (month > monthCount) monthCount = month;

        emit MonthScheduled(month, start, end);
    }

    /// @notice Proposes `account` as an administrator. It becomes one only when it calls `acceptAdmin` itself,
    /// which proves that someone controls it on this network (no typo, no zero address, no multisig created on
    /// another network). Direct `grantRole` of the administrator role is disabled.
    function proposeAdmin(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (hasRole(DEFAULT_ADMIN_ROLE, account)) revert AlreadyAdmin();
        isProposedAdmin[account] = true;
        emit AdminProposed(account, msg.sender);
    }

    /// @notice Withdraws a pending proposal.
    function cancelAdminProposal(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!isProposedAdmin[account]) revert NotProposed();
        isProposedAdmin[account] = false;
        emit AdminProposalCancelled(account, msg.sender);
    }

    /// @notice Accepts a pending proposal: the caller becomes an administrator.
    function acceptAdmin() external {
        if (!isProposedAdmin[msg.sender]) revert NotProposed();
        // forge-lint: disable-next-line(missing-events-access-control) `_grantRole` emits RoleGranted right after
        isProposedAdmin[msg.sender] = false;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /// @dev The administrator role is only granted through `proposeAdmin` / `acceptAdmin`.
    function grantRole(bytes32 role, address account) public override(AccessControl, IAccessControl) {
        if (role == DEFAULT_ADMIN_ROLE) revert UseAdminProposal();
        super.grantRole(role, account);
    }

    /// @notice Sets the address returned by `owner()`, which marketplaces use to let it manage the collection page.
    /// It grants no right in this contract: administration stays with the administrators.
    function setOwner(address newOwner) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setOwner(newOwner);
    }

    /// @notice Sets the collection logo and website. The website also gives each token its `external_url`
    /// (`<siteUrl>/token/<tokenId>`). Empty values are omitted from the metadata.
    function setCollectionInfo(string calldata image, string calldata url) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _checkJsonSafe(image);
        _checkJsonSafe(url);
        collectionImage = image;
        siteUrl = url;
        emit ContractURIUpdated();
        if (totalMinted > 0) emit BatchMetadataUpdate(1, totalMinted);
    }

    // Rescue of assets sent to this contract by mistake. Tokens of this collection are never movable by
    // administrators. Plain POL transfers are already rejected (no receive function); only forced ones can land here.
    // ERC-1155 tokens cannot land here: their transfers always call a receiver hook this contract does not implement.

    /// @notice Sends native POL held by this contract (forced transfers only) to `to`.
    function rescueNative(address payable to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        emit Rescued(address(0), to, amount);
        // forge-lint: disable-next-line(arbitrary-send-eth) admin-only; the destination is chosen by administrators
        Address.sendValue(to, amount);
    }

    /// @notice Sends ERC-20 tokens held by this contract to `to`.
    function rescueERC20(IERC20 token, address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        emit Rescued(address(token), to, amount);
        token.safeTransfer(to, amount);
    }

    /// @notice Sends an NFT of another collection held by this contract to `to`. Never applies to this collection.
    function rescueERC721(IERC721 token, uint256 tokenId, address to) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (address(token) == address(this)) revert CannotRescueOwnTokens();
        emit Rescued(address(token), to, tokenId);
        token.safeTransferFrom(address(this), to, tokenId);
    }

    /// @notice Updates the address receiving the team proofs of the months not yet claimed.
    function setTeamRecipient(address recipient) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setTeamRecipient(recipient);
    }

    /// @notice Permanently stops claims and scheduling. Transfers and metadata keep working.
    function shutdown() external onlyRole(DEFAULT_ADMIN_ROLE) notShutDown {
        isShutDown = true;
        emit ShutDown(msg.sender);
    }

    // ---------------------------------------------------------------------
    // Claim
    // ---------------------------------------------------------------------

    /// @notice Mints a token of the active `month` to `recipient`. Anyone may submit the proof for the recipient.
    /// @dev The proof is judged against the target at inclusion: claims included in between make it harder.
    function claim(uint256 month, address recipient, uint256 nonce) external notShutDown returns (uint256 tokenId) {
        if (month == 0 || month > monthCount) revert UnknownMonth();
        Month storage m = _months[month];
        if (block.timestamp < m.start || block.timestamp >= m.end) revert MonthNotActive();
        if (hasClaimed[month][recipient]) revert AlreadyClaimed();

        bytes32 seed = monthSeed(month);
        bytes32 hash = keccak256(abi.encode(seed, month, recipient, nonce));
        uint256 target = _scheduleTarget(m.end - m.start, block.timestamp - m.start, m.minted);
        if (uint256(hash) >= target) revert InsufficientWork();

        hasClaimed[month][recipient] = true;
        bytes32 acc = m.accumulator;
        if (acc == 0) acc = keccak256(abi.encode(seed, month));
        // forge-lint: disable-next-line(weak-prng) entropy accumulation for the next seed, not a random draw
        m.accumulator = keccak256(abi.encode(acc, blockhash(block.number - 1), recipient, nonce));

        uint32 number = ++m.minted;
        tokenId = _nextTokenId(m);
        _tokens[tokenId] = TokenData({
            // forge-lint: disable-next-line(unsafe-typecast) month <= monthCount, one month per 25+ days
            month: uint32(month),
            number: number,
            // forge-lint: disable-next-line(unsafe-typecast) at most 256
            leadingZeroBits: uint16(_leadingZeroBits(hash)),
            edition: Edition.Mined,
            target: target
        });

        // forge-lint: disable-next-line(reentrancy-events) false positive: no external call precedes this event
        emit Claimed(tokenId, month, recipient, number, hash);
        _safeMint(recipient, tokenId);
    }

    /// @notice Mints the artist proof (to the month's artist address) or the team proof (to `teamRecipient`) of the
    /// active `month`. Callable by anyone; each proof exists at most once per month. Proofs are independent of
    /// mined claims: a third party mining a claim on behalf of the recipient cannot block its proof.
    function claimReserved(uint256 month, Edition edition) external notShutDown returns (uint256 tokenId) {
        if (month == 0 || month > monthCount) revert UnknownMonth();
        Month storage m = _months[month];
        if (block.timestamp < m.start || block.timestamp >= m.end) revert MonthNotActive();

        address recipient;
        if (edition == Edition.ArtistProof) {
            if (m.artistProofMinted) revert ProofAlreadyMinted();
            m.artistProofMinted = true;
            recipient = m.content.artistAddress;
        } else if (edition == Edition.TeamProof) {
            if (m.teamProofMinted) revert ProofAlreadyMinted();
            m.teamProofMinted = true;
            recipient = teamRecipient;
        } else {
            revert NotAProof();
        }
        if (recipient == address(0)) revert NoRecipient();

        tokenId = _nextTokenId(m);
        // forge-lint: disable-next-line(unsafe-typecast) month <= monthCount, one month per 25+ days
        _tokens[tokenId] = TokenData({month: uint32(month), number: 0, leadingZeroBits: 0, edition: edition, target: 0});

        emit ProofClaimed(tokenId, month, recipient, edition);
        _safeMint(recipient, tokenId);
    }

    /// @notice Signals marketplaces (EIP-4906) that the month's tokens now show their final total.
    /// Callable by anyone, once, after the month has closed.
    function announceMonthTotal(uint256 month) external {
        if (month == 0 || month > monthCount) revert UnknownMonth();
        Month storage m = _months[month];
        if (!_isClosed(m)) revert MonthNotClosed();
        if (m.totalAnnounced) revert AlreadyAnnounced();
        m.totalAnnounced = true;

        emit MonthTotalAnnounced(month, m.minted);
        uint256 count = _tokenCount(m);
        if (count > 0) emit BatchMetadataUpdate(m.firstTokenId, m.firstTokenId + count - 1);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice Target a claim of `month` would face at `timestamp`, given the tokens minted so far.
    /// It only decreases with new claims and only increases (eases) with time.
    function targetAt(uint256 month, uint256 timestamp) public view returns (uint256) {
        if (month == 0 || month > monthCount) revert UnknownMonth();
        Month storage m = _months[month];
        if (timestamp < m.start || timestamp >= m.end) revert MonthNotActive();
        return _scheduleTarget(m.end - m.start, timestamp - m.start, m.minted);
    }

    /// @notice Month whose claims are open now, or 0 if none.
    function activeMonth() external view returns (uint256) {
        // Months are ordered and never overlap: the last one already started is the only candidate.
        for (uint256 i = monthCount; i > 0; i--) {
            Month storage m = _months[i];
            if (block.timestamp >= m.start) return block.timestamp < m.end ? i : 0;
        }
        return 0;
    }

    /// @notice Address marketplaces treat as the collection owner (ERC-173 view). Grants no right in this contract.
    function owner() public view returns (address) {
        return _owner;
    }

    /// @notice Collection-level metadata (ERC-7572), as on-chain JSON.
    function contractURI() external view returns (string memory) {
        string memory json = string.concat(
            '{"name":"',
            name(),
            '","description":"',
            _description,
            bytes(collectionImage).length > 0 ? string.concat('","image":"', collectionImage) : "",
            bytes(siteUrl).length > 0 ? string.concat('","external_link":"', siteUrl) : "",
            '"}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    /// @notice Target a claim of `month` would face if included now.
    function currentTarget(uint256 month) external view returns (uint256) {
        return targetAt(month, block.timestamp);
    }

    /// @notice Seed of `month`. Final once the previous month has ended.
    function monthSeed(uint256 month) public view returns (bytes32 seed) {
        if (month == 0 || month > monthCount) revert UnknownMonth();
        uint256 last = month - 1;
        while (last > 0 && _months[last].accumulator == 0) last--;
        seed = last == 0 ? genesisSeed : _months[last].accumulator;
        // Months without claim: their accumulator stays at its initial value keccak256(seed, month).
        for (uint256 i = last + 1; i < month; i++) {
            seed = keccak256(abi.encode(seed, i));
        }
    }

    function getMonth(uint256 month)
        external
        view
        returns (uint64 start, uint64 end, uint32 minted, bool closed, MonthContent memory content)
    {
        if (month == 0 || month > monthCount) revert UnknownMonth();
        Month storage m = _months[month];
        return (m.start, m.end, m.minted, _isClosed(m), m.content);
    }

    function proofsMinted(uint256 month) external view returns (bool artistProof, bool teamProof) {
        if (month == 0 || month > monthCount) revert UnknownMonth();
        Month storage m = _months[month];
        return (m.artistProofMinted, m.teamProofMinted);
    }

    function tokenData(uint256 tokenId) external view returns (TokenData memory) {
        _requireOwned(tokenId);
        return _tokens[tokenId];
    }

    /// @notice On-chain JSON metadata, named "<label> • #<number>", then "<label> • #<number> / <total>" once the
    /// month has closed (the total also becomes an attribute). Proofs are named "<label> • Artist proof" and
    /// "<label> • Team proof".
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return string.concat("data:application/json;base64,", Base64.encode(_tokenJson(tokenId)));
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, AccessControlEnumerable, IERC165)
        returns (bool)
    {
        return interfaceId == bytes4(0x49064906) || super.supportsInterface(interfaceId);
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    /// @dev floor * 2^((S - minted) / CLAIMS_PER_DOUBLING), capped at the floor, with the schedule
    /// S = SUPPLY_PER_MONTH * elapsed / duration. Both sides are scaled by `duration` to stay in integers.
    function _scheduleTarget(uint256 duration, uint256 elapsed, uint256 minted) internal pure returns (uint256) {
        // Both products stay far below 2^255: elapsed and duration <= 35 days, minted < 2^32.
        // forge-lint: disable-next-line(unsafe-typecast)
        int256 ahead = int256(elapsed * SUPPLY_PER_MONTH) - int256(minted * duration);
        return Exp2.mulExp2(_maxTarget(), ahead, duration * CLAIMS_PER_DOUBLING, _maxTarget());
    }

    /// @dev Token ids are global; the first token of a month marks the start of its contiguous range.
    function _nextTokenId(Month storage m) internal returns (uint256 tokenId) {
        tokenId = ++totalMinted;
        // forge-lint: disable-next-line(unsafe-typecast) token ids are sequential, far below 2^64
        if (m.firstTokenId == 0) m.firstTokenId = uint64(tokenId);
    }

    function _tokenCount(Month storage m) internal view returns (uint256) {
        return uint256(m.minted) + (m.artistProofMinted ? 1 : 0) + (m.teamProofMinted ? 1 : 0);
    }

    function _tokenJson(uint256 tokenId) internal view returns (bytes memory) {
        TokenData memory t = _tokens[tokenId];
        Month storage m = _months[t.month];
        MonthContent storage c = m.content;
        bool closed = _isClosed(m);

        string memory title;
        if (t.edition == Edition.Mined) {
            title = string.concat("#", uint256(t.number).toString());
            if (closed) title = string.concat(title, " / ", uint256(m.minted).toString());
        } else {
            title = _editionName(t.edition);
        }

        return bytes(
            string.concat(
                '{"name":"',
                c.label,
                unicode" • ",
                title,
                '","description":"',
                _description,
                '","image":"',
                c.image,
                bytes(c.animationUrl).length > 0 ? string.concat('","animation_url":"', c.animationUrl) : "",
                bytes(siteUrl).length > 0
                    ? string.concat('","external_url":"', siteUrl, "/token/", tokenId.toString())
                    : "",
                '","attributes":',
                _attributes(t, m, closed),
                "}"
            )
        );
    }

    function _attributes(TokenData memory t, Month storage m, bool closed) internal view returns (string memory a) {
        bool mined = t.edition == Edition.Mined;
        a = string.concat(
            '[{"trait_type":"Month","value":"',
            m.content.label,
            '"},{"trait_type":"Artist","value":"',
            m.content.artist,
            '"},{"trait_type":"Edition","value":"',
            _editionName(t.edition),
            '"}'
        );
        if (mined) a = string.concat(a, _numberTrait("Number", t.number));
        if (closed) a = string.concat(a, _numberTrait("Total", m.minted));
        if (mined) {
            a = string.concat(
                a,
                _numberTrait("Difficulty", type(uint256).max / t.target),
                _numberTrait("Leading zero bits", t.leadingZeroBits)
            );
        }
        a = string.concat(a, "]");
    }

    function _numberTrait(string memory traitType, uint256 value) internal pure returns (string memory) {
        return string.concat(',{"trait_type":"', traitType, '","display_type":"number","value":', value.toString(), "}");
    }

    function _editionName(Edition edition) internal pure returns (string memory) {
        if (edition == Edition.ArtistProof) return "Artist proof";
        if (edition == Edition.TeamProof) return "Team proof";
        return "Mined";
    }

    /// @dev A month is closed when it has ended, or when claims stopped for good.
    function _isClosed(Month storage m) internal view returns (bool) {
        return block.timestamp >= m.end || isShutDown;
    }

    /// @dev Difficulty floor. Virtual only so that tests can use an easy floor; production uses `MAX_TARGET`.
    function _maxTarget() internal pure virtual returns (uint256) {
        return MAX_TARGET;
    }

    function _setOwner(address newOwner) internal {
        emit OwnershipTransferred(_owner, newOwner);
        _owner = newOwner;
    }

    function _setTeamRecipient(address recipient) internal {
        teamRecipient = recipient;
        emit TeamRecipientUpdated(recipient);
    }

    /// @dev Prevents revoking or renouncing the last administrator.
    function _revokeRole(bytes32 role, address account) internal override returns (bool revoked) {
        revoked = super._revokeRole(role, account);
        if (role == DEFAULT_ADMIN_ROLE && getRoleMemberCount(DEFAULT_ADMIN_ROLE) == 0) revert LastAdmin();
    }

    function _leadingZeroBits(bytes32 hash) internal pure returns (uint256) {
        uint256 h = uint256(hash);
        return h == 0 ? 256 : 255 - Math.log2(h);
    }

    /// @dev Strings are embedded verbatim in the JSON metadata: reject quotes, backslashes and control characters.
    function _checkJsonSafe(string memory s) internal pure {
        bytes memory b = bytes(s);
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            // forge-lint: disable-next-line(require-revert-in-loop) rejecting the whole string is the intent
            if (c == '"' || c == "\\" || c < 0x20) revert UnsafeString();
        }
    }
}
