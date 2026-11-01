// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Fixed-point exponentiation in base 2, as used by the ASERT difficulty algorithm.
library Exp2 {
    /// @notice Returns `x * 2^(num / den)`, capped at `cap` and never below 1.
    /// @dev The fractional part uses the cubic approximation of Bitcoin Cash `aserti3-2d`
    /// (16-bit precision, max relative error ~0.013 %). Requires `x <= cap < 2^255`.
    function mulExp2(uint256 x, int256 num, uint256 den, uint256 cap) internal pure returns (uint256) {
        // forge-lint: disable-next-line(unsafe-typecast) callers pass small denominators (< 2^64)
        int256 d = int256(den);
        int256 q = num / d;
        int256 r = num % d;
        if (r < 0) {
            q -= 1;
            r += d;
        }

        // forge-lint: disable-next-line(unsafe-typecast) r is non-negative here
        uint256 frac = (uint256(r) << 16) / den;
        // Intentional 16-bit fixed point (aserti3-2d): `frac` is truncated before the polynomial.
        // forge-lint: disable-start(divide-before-multiply)
        uint256 factor =
            65536 + ((195766423245049 * frac + 971821376 * frac * frac + 5127 * frac * frac * frac + (1 << 47)) >> 48);
        // forge-lint: disable-end(divide-before-multiply)
        uint256 y = Math.mulDiv(x, factor, 65536);

        if (q >= 0) {
            // forge-lint: disable-next-line(unsafe-typecast) q >= 0 in this branch
            uint256 shift = uint256(q);
            if (shift >= 256 || y > (cap >> shift)) return cap;
            y <<= shift;
        } else {
            // forge-lint: disable-next-line(unsafe-typecast) q < 0 in this branch
            uint256 shift = uint256(-q);
            y = shift >= 256 ? 0 : y >> shift;
        }

        if (y > cap) return cap;
        return y == 0 ? 1 : y;
    }
}
