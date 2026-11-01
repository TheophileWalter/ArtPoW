# Static analysis notes

`forge lint src` reports no finding. This page lists every finding that was reviewed and either fixed or
acknowledged, so that auditors can check each decision. Acknowledged findings carry an inline
`forge-lint: disable` comment that states the reason.

## Fixed

| Rule | Location | Change |
|---|---|---|
| `reentrancy-events` | `rescueNative`, `rescueERC20`, `rescueERC721` | `Rescued` is now emitted before the external call (checks-effects-interactions). |
| `encode-packed-collision` | `contractURI`, `_tokenJson` | JSON is built with `string.concat` instead of `abi.encodePacked`. The output is unchanged and was never hashed. |

## Acknowledged

| Rule | Location | Reason |
|---|---|---|
| `block-timestamp` | Calendar checks, `_isClosed`, `activeMonth`, difficulty schedule | Excluded in `foundry.toml`. Months and the difficulty schedule are defined in time by design. A validator can only shift `block.timestamp` by a few seconds; with ~2,600 s of schedule per token, this moves the target by a negligible fraction of a token and cannot open or close a month early in any meaningful way. |
| `weak-prng` | `claim`, accumulator update | The accumulator is not a random draw. It chains every claim of a month (previous block hash, recipient, nonce) so that the next month's seed cannot be computed before the month ends. A participant who submits the very last claim knows the next seed a few seconds early; this is accepted, as the difficulty schedule throttles any burst at the start of a month. |
| `unsafe-typecast` | `uint32(month)` | `month <= monthCount`, and each month lasts at least 25 days. |
| `unsafe-typecast` | `uint16(_leadingZeroBits(hash))` | At most 256. |
| `unsafe-typecast` | `uint64(tokenId)` | Token ids are sequential, far below 2^64. |
| `unsafe-typecast` | `int256(...)` in `_scheduleTarget` | `elapsed`, `duration` <= 35 days and `minted` < 2^32, so both products are far below 2^255. |
| `unsafe-typecast` | `Exp2.mulExp2` | `int256(den)`: callers pass `duration * CLAIMS_PER_DOUBLING` < 2^64. `uint256(r)`: `r >= 0` after normalisation. `uint256(q)` / `uint256(-q)`: guarded by the sign of `q`; `-q` cannot overflow because `den >= 1` and checked arithmetic would revert. |
| `divide-before-multiply` | `Exp2.mulExp2` | Intentional: the fractional exponent is quantised to 16 bits before the cubic approximation, exactly as in Bitcoin Cash `aserti3-2d`. Precision is verified by `test_Exp2ExactPowers` and the differential tests. |
| `require-revert-in-loop` | `_checkJsonSafe` | Rejecting the whole string on the first unsafe character is the intent. |
| `arbitrary-send-eth` | `rescueNative` | Restricted to administrators, who choose the destination of POL sent to the contract by a forced transfer. |
| `reentrancy-events` | `claim` (`Claimed`) | False positive: no external call precedes the event; the only external call (`_safeMint` receiver hook) comes after it. |

## Compiler

Sources pin `pragma solidity 0.8.30` (optimizer 200 runs, EVM `cancun`, see `foundry.toml`) so that the deployed
bytecode can be reproduced and verified on Polygonscan. The deployed code uses `PUSH0` and `MCOPY`.

## Design properties relevant to review

- **Reentrancy.** `claim` and `claimReserved` update all state before `_safeMint`, the only external call. A
  re-entering receiver can only start another claim, which is checked independently (one claim per address and
  per month, schedule recomputed from storage); see `test_ReentrancyKeepsStateConsistent`.
- **Administrator powers.** Administrators cannot move, burn or freeze holders' tokens, and cannot rescue tokens
  of this collection. Their powers are: scheduling months that have not started, setting the team recipient,
  the `owner()` address and the collection info, rescuing foreign assets, managing administrators, and an
  irreversible `shutdown`.
- **Two-step administrator nomination.** `proposeAdmin` then `acceptAdmin` from the proposed address itself;
  `grantRole(DEFAULT_ADMIN_ROLE, ·)` reverts. Only addresses that sent a transaction on this network can become
  administrators, so the last-administrator guard cannot be bypassed with an uncontrolled address (zero address,
  typo, multisig deployed on another network). `acceptAdmin` clears the proposal without its own event; the
  `RoleGranted` event emitted by `_grantRole` in the same call records it.
- **Seed integrity.** Proofs (artist and team) do not touch the accumulator, so administrators cannot influence
  the next seed by choosing when to mint them.
- **Proofs are independent of mined claims.** A third party can mine a claim on behalf of any address; if proofs
  counted as their recipient's claim, this would block them. They do not (`test_ProofCannotBeGriefedByThirdPartyClaim`).
- **Known, accepted:** the seed of a month is public before its start between deployment and month 1, during a
  gap between months, and speculatively at the end of a quiet month. The schedule bounds the resulting burst at
  the start of the month to roughly 10 tokens per doubling of pre-mined work (≈ 160 tokens for one GPU-week).
- **Invariants** (`test/Invariants.t.sol`): token ranges tile `1..totalMinted` month by month; mined numbers run
  `1..minted`; one mined claim per address and per month; months are ordered, never overlap and last 25 to 35 days;
  the target never exceeds the floor.
