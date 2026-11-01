"""Generates sim/vectors.json, checked against the contract by test/Differential.t.sol."""

import json
import random
from pathlib import Path

from difficulty import mul_exp2, schedule_target

rng = random.Random(42)
EASY_MAX = 1 << 250  # Harness floor in the Foundry tests

exp2 = []
for _ in range(300):
    cap = (1 << rng.randint(1, 254)) + rng.randint(0, 1 << 20)
    x = rng.randint(1, cap)
    num = rng.choice([rng.randint(-10**6, 10**6), rng.randint(-86400, 86400), rng.randint(-10**10, 10**10)])
    exp2.append({"x": str(x), "num": str(num), "cap": str(cap), "out": str(mul_exp2(x, num, 43200, cap))})

schedule = []
for _ in range(300):
    duration = rng.choice([28, 29, 30, 31]) * 86400 + rng.randint(-3600, 3600)
    elapsed = rng.randint(0, duration - 1)
    expected = 1000 * elapsed // duration
    minted = max(0, expected + rng.randint(-50, 300))
    schedule.append({"duration": duration, "elapsed": elapsed, "minted": minted,
                     "out": str(schedule_target(duration, elapsed, minted, EASY_MAX))})

# Same with the production floor (2^228), checked against an un-overridden contract.
schedule_prod = []
for _ in range(300):
    duration = rng.randint(25 * 86400, 35 * 86400)
    elapsed = rng.randint(0, duration - 1)
    minted = max(0, 1000 * elapsed // duration + rng.randint(-100, 3000))
    schedule_prod.append({"duration": duration, "elapsed": elapsed, "minted": minted,
                          "out": str(schedule_target(duration, elapsed, minted))})

out = {
    "exp2": {k: [v[k] for v in exp2] for k in ("x", "num", "cap", "out")},
    "schedule": {k: [v[k] for v in schedule] for k in ("duration", "elapsed", "minted", "out")},
    "schedule_prod": {k: [v[k] for v in schedule_prod] for k in ("duration", "elapsed", "minted", "out")},
}
Path(__file__).with_name("vectors.json").write_text(json.dumps(out))
print(f"{len(exp2)} exp2 vectors, {len(schedule)} + {len(schedule_prod)} schedule vectors")
