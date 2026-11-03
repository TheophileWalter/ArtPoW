"""Error of the contract's difficulty curve against the true curve 2^(num/den), computed without any approximation.

The reference is 2^x in 60-digit decimal arithmetic, not the contract's polynomial. Usage: python3 sim/exp2_error.py
"""

import random
from decimal import Decimal, getcontext
from fractions import Fraction

from difficulty import CLAIMS_PER_DOUBLING, FLOOR_DIFFICULTY_BITS, MAX_TARGET, SUPPLY_PER_MONTH, mul_exp2, schedule_target

getcontext().prec = 60
LN2 = Decimal(2).ln()
ONE = 1 << 16
SAMPLES = 200_000
DURATION = 30 * 86400


def true_pow2(x: Fraction) -> Decimal:
    """2^x for a rational x."""
    return (Decimal(x.numerator) / Decimal(x.denominator) * LN2).exp()


def factor(frac: int) -> int:
    """16.16 factor of the contract for a 16-bit fractional exponent, read back through the port."""
    return mul_exp2(ONE, frac, ONE, 1 << 32)


def relative(approx: Decimal, true: Decimal) -> Decimal:
    return approx / true - 1


def percent(value: Decimal) -> str:
    return f"{float(value) * 100:+.6f} %"


def main() -> None:
    factors = [factor(f) for f in range(ONE)]
    assert factors[0] == ONE
    assert all(a <= b for a, b in zip(factors, factors[1:])), "factor decreases"
    assert 2 * ONE >= factors[-1], "factor decreases across a power of two"
    flat = sum(a == b for a, b in zip(factors, factors[1:]))
    print(f"Factor never decreases over the {ONE} values nor across powers of two ({flat} flat steps)")

    # Each frac stands for every exponent of [f, f + 1) / 2^16: since 2^x grows, the error is largest at the ends.
    bounds = [true_pow2(Fraction(f, ONE)) for f in range(ONE + 1)]
    at_start = [relative(Decimal(factors[f]) / ONE, bounds[f]) for f in range(ONE)]
    at_end = [relative(Decimal(factors[f]) / ONE, bounds[f + 1]) for f in range(ONE)]

    worst_high = max(range(ONE), key=lambda f: at_start[f])
    worst_low = min(range(ONE), key=lambda f: at_end[f])
    print("\nPolynomial alone, exponents exactly on the 16-bit grid")
    print(f"  highest {percent(max(at_start))}, lowest {percent(min(at_start))}")
    print(f"  mean    {percent(sum(at_start) / ONE)}, mean absolute {percent(sum(map(abs, at_start)) / ONE)}")
    print("\nWith the truncation of the exponent to 16 bits (every real exponent)")
    print(f"  highest {percent(at_start[worst_high])} at x = {worst_high / ONE:.6f}")
    print(f"  lowest  {percent(at_end[worst_low])} at x -> {(worst_low + 1) / ONE:.6f}")

    # The real path, integer shifts included: random states of a 30-day month, on the true curve below the floor.
    rng = random.Random(1)
    high, low, total = Decimal(-1), Decimal(1), Decimal(0)
    for _ in range(SAMPLES):
        elapsed = rng.randrange(DURATION)
        ahead_tokens = rng.randrange(1, 2000)
        minted = elapsed * SUPPLY_PER_MONTH // DURATION + ahead_tokens
        num = elapsed * SUPPLY_PER_MONTH - minted * DURATION
        den = DURATION * CLAIMS_PER_DOUBLING
        err = relative(Decimal(schedule_target(DURATION, elapsed, minted)), MAX_TARGET * true_pow2(Fraction(num, den)))
        high, low, total = max(high, err), min(low, err), total + abs(err)
    print(f"\nFull contract path, {SAMPLES} random states of a 30-day month, 1 to 1999 tokens ahead")
    print(f"  highest {percent(high)}, lowest {percent(low)}, mean absolute {percent(total / SAMPLES)}")

    worst = max(abs(at_start[worst_high]), abs(at_end[worst_low]))
    tokens = float((1 + worst).ln() / LN2) * CLAIMS_PER_DOUBLING
    print(f"\nWorst error in tokens ahead: {tokens:.5f} token")

    # Integer shifts lose precision only once the target is small: what remains is the 17-bit factor shifted right.
    print("\nFar along the curve, integer truncation of the target")
    print("  tokens ahead  difficulty     target  worst error over one token")
    for tokens_ahead in (2000, 2100, 2120, 2130, 2150, 2200, 2250, 2270, 2279):
        errors = []
        for step in range(0, 2000):
            num = -(tokens_ahead * DURATION) - step * DURATION // 2000
            den = DURATION * CLAIMS_PER_DOUBLING
            target = mul_exp2(MAX_TARGET, num, den, MAX_TARGET)
            errors.append(relative(Decimal(target), MAX_TARGET * true_pow2(Fraction(num, den))))
        bits = FLOOR_DIFFICULTY_BITS + tokens_ahead // CLAIMS_PER_DOUBLING
        target = mul_exp2(MAX_TARGET, -(tokens_ahead * DURATION), DURATION * CLAIMS_PER_DOUBLING, MAX_TARGET)
        print(f"  {tokens_ahead:12d}  2^{bits:<9d}  {target:9d}  {percent(max(errors, key=abs))}")


if __name__ == "__main__":
    main()
