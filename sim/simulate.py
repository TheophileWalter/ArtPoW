"""Monte-Carlo simulation of one month under several demand scenarios, with the contract's difficulty rule.

Model (1-minute steps, exact contract target from difficulty.py):
- humans arrive over the month, each mines in a browser with a lognormal hashrate and gives up after a
  lognormal patience; one claim per human. They mine with a safety margin of MARGIN claims (they aim at the
  target the contract would have after MARGIN more claims), and a proof is checked again at inclusion;
- farmers mine continuously with a fixed hashrate and unlimited addresses, and submit as soon as they find.

Usage: python3 sim/simulate.py [--runs N] [--margin M]
"""

import argparse
import math
import random
import statistics

from difficulty import CLAIMS_PER_DOUBLING, MAX_TARGET, schedule_target

TWO_256 = float(1 << 256)
HUMAN_MEDIAN_HS = 4e6  # browser, all cores, WASM miner (measured 2 MH/s per thread)
HUMAN_SIGMA = 0.7  # phones ~1 MH/s ... recent laptops ~15 MH/s
PATIENCE_MEDIAN_MIN = 15
PATIENCE_SIGMA = 1.0
GPU_HS = 5e9  # RTX 4090, hashcat mode 17800 (single Keccak-f block)


def uniform(count):
    return lambda rng, minutes: sorted(rng.uniform(0, minutes) for _ in range(count))


def launch(burst, burst_hours, tail_per_day):
    def gen(rng, minutes):
        a = [m for m in (rng.expovariate(3 / (burst_hours * 60)) for _ in range(burst)) if m < minutes]
        a += [rng.uniform(0, minutes) for _ in range(tail_per_day * minutes // 1440)]
        return sorted(a)

    return gen


def run(arrivals_gen, farmers, seed, days=30, margin=2):
    rng = random.Random(seed)
    minutes = days * 1440
    duration = days * 86400
    minted = 0

    def target(t_s, extra=0):
        return schedule_target(duration, int(t_s), minted + extra)

    arrivals = arrivals_gen(rng, minutes)
    nxt, active = 0, []  # [start_minute, hashrate, deadline]
    humans = farmer_claims = stale = 0
    times = []
    max_bits = 0.0

    for minute in range(minutes):
        t0 = minute * 60
        while nxt < len(arrivals) and arrivals[nxt] < minute + 1:
            h = HUMAN_MEDIAN_HS * math.exp(rng.gauss(0, HUMAN_SIGMA))
            active.append([minute, h, minute + PATIENCE_MEDIAN_MIN * math.exp(rng.gauss(0, PATIENCE_SIGMA))])
            nxt += 1

        max_bits = max(max_bits, math.log2(TWO_256 / target(t0)))
        aim = target(t0, margin)  # humans mine with a margin
        events = []
        for human in active:
            if rng.random() < -math.expm1(-human[1] * 60 * aim / TWO_256):
                events.append((t0 + rng.uniform(0, 60), "h", human, aim))
        for hs, start, end in farmers:
            if start <= minute < end:
                events.append((t0, "f", hs, None))

        done = set()
        for t, kind, payload, mined_for in sorted(events, key=lambda e: e[0]):
            if kind == "f":
                # Sequential farmer proofs within the minute: each claim hardens the next one.
                while True:
                    t += rng.expovariate(payload * target(t) / TWO_256)
                    if t >= t0 + 60:
                        break
                    minted += 1
                    farmer_claims += 1
                continue
            now = target(t)
            # The hash is uniform below the target it was mined for; it must still beat the target at inclusion.
            if rng.random() < min(1.0, now / mined_for):
                minted += 1
                humans += 1
                times.append(minute + 1 - payload[0])
                done.add(id(payload))
            else:
                stale += 1
        active = [h for h in active if id(h) not in done and minute + 1 < h[2]]

    return {
        "total": minted, "humans": humans, "farmers": farmer_claims,
        "served": humans / max(1, len(arrivals)),
        "median": statistics.median(times) if times else float("nan"),
        "p90": statistics.quantiles(times, n=10)[-1] if len(times) > 10 else float("nan"),
        "stale": stale, "max_bits": max_bits,
    }


SCENARIOS = [
    ("300 humains", uniform(300), [], 30),
    ("3000 humains", uniform(3000), [], 30),
    ("3000 humains, mois de 31 j", uniform(3000), [], 31),
    ("3000 humains, mois de 28 j", uniform(3000), [], 28),
    ("Lancement : 2000 en 48 h, puis 20/j", launch(2000, 48, 20), [], 30),
    ("300 humains + serveur 64 cœurs", uniform(300), [(128e6, 0, 30 * 1440)], 30),
    ("300 humains + 1 GPU tout le mois", uniform(300), [(GPU_HS, 0, 30 * 1440)], 30),
    ("300 humains + 1 GPU dès J25", uniform(300), [(GPU_HS, 25 * 1440, 30 * 1440)], 30),
    ("3000 humains + 1 GPU pendant 2 h à J15", uniform(3000), [(GPU_HS, 15 * 1440, 15 * 1440 + 120)], 30),
    ("300 humains + 10 GPU tout le mois", uniform(300), [(10 * GPU_HS, 0, 30 * 1440)], 30),
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--margin", type=int, default=2)
    args = parser.parse_args()

    print(f"Plancher 2^{257 - MAX_TARGET.bit_length()} hashes, H = {CLAIMS_PER_DOUBLING}, marge de minage "
          f"{args.margin}, humain médian {HUMAN_MEDIAN_HS / 1e6:.0f} MH/s, GPU {GPU_HS / 1e9:.0f} GH/s, "
          f"{args.runs} tirages (moyennes)\n")
    print(f"{'Scénario':40} {'mintés':>7} {'humains':>8} {'fermes':>7} {'servis':>7} {'méd.':>7} {'p90':>7} "
          f"{'périmées':>9} {'diff max':>9}")
    for name, gen, farmers, days in SCENARIOS:
        res = [run(gen, farmers, s, days, args.margin) for s in range(args.runs)]
        a = {k: statistics.fmean(r[k] for r in res) for k in res[0]}
        print(f"{name:40} {a['total']:7.0f} {a['humans']:8.0f} {a['farmers']:7.0f} {a['served']:7.0%} "
              f"{a['median']:5.1f}mn {a['p90']:5.1f}mn {a['stale']:9.1f} {'2^' + format(a['max_bits'], '.1f'):>9}")


if __name__ == "__main__":
    main()
