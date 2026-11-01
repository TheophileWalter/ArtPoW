// Simplified model of a month, for the explainer page. Same difficulty rule as the contract; people and farms are
// modelled as flows (no randomness), so a scenario always draws the same curve. The full Monte-Carlo simulation is
// in ../../sim (see the whitepaper, "Measurements and Simulations").

export const FLOOR_BITS = 28;
export const MONTH_TARGET = 1000;
export const HALF_LIFE = 10; // tokens ahead of the schedule that double the difficulty
export const BROWSER_RATE = 4e6; // hashes per second of a median browser
export const GPU_RATE = 5e9;

/** Expected hashes for one proof when `ahead` tokens are minted ahead of the schedule (never below the floor). */
export const hashesNeeded = (ahead) => 2 ** FLOOR_BITS * 2 ** (Math.max(0, ahead) / HALF_LIFE);

/** Tokens the schedule expects after `day` days of a `days`-day month. */
export const scheduled = (day, days = 30) => (MONTH_TARGET * day) / days;

/**
 * Tokens `work` hashes buy from `minted` tokens at `day`, each token raising the difficulty of the next: the floor
 * part first (behind the schedule), then a geometric series of ratio 2^(1/10).
 */
function tokensForWork(work, minted, day, days) {
  const behind = Math.max(0, scheduled(day, days) - minted);
  const atFloor = Math.min(behind, work / hashesNeeded(0));
  work -= atFloor * hashesNeeded(0);
  if (work <= 0) return atFloor;
  const r = 2 ** (1 / HALF_LIFE);
  const first = hashesNeeded(minted + atFloor - scheduled(day, days));
  return atFloor + Math.log(1 + (work * (r - 1)) / first) / Math.log(r);
}

/**
 * Simulates a month minute by minute.
 * people: number of people who come to mine, arriving evenly over `arrivalDays` from the start;
 * patience: average minutes a person keeps mining before giving up;
 * gpus: GPUs mining continuously from day `gpuFrom` to day `gpuTo`.
 * Returns hourly points { day, minted, byPeople, byFarm, scheduled } and the totals.
 */
export function simulateMonth({ people = 300, arrivalDays = 30, patience = 90, gpus = 0, gpuFrom = 0, gpuTo = 30, days = 30 }) {
  const step = 60; // seconds
  const steps = (days * 86400) / step;
  const arrivalsPerStep = people / ((arrivalDays * 86400) / step);
  let waiting = 0;
  let byPeople = 0;
  let byFarm = 0;
  let gaveUp = 0;
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const day = (i * step) / 86400;
    if (i % 60 === 0) points.push({ day, minted: byPeople + byFarm, byPeople, byFarm, scheduled: scheduled(day, days) });
    if (i === steps) break;
    if (day < arrivalDays) waiting += arrivalsPerStep;
    const need = hashesNeeded(byPeople + byFarm - scheduled(day, days));
    // Each waiting person finds a proof with probability 1 - exp(-work / need) during this step.
    const found = waiting * (1 - Math.exp((-BROWSER_RATE * step) / need));
    const left = (waiting - found) * (step / 60 / patience);
    waiting -= found + left;
    byPeople += found;
    gaveUp += left;
    if (gpus > 0 && day >= gpuFrom && day < gpuTo) byFarm += tokensForWork(gpus * GPU_RATE * step, byPeople + byFarm, day, days);
  }
  const minted = byPeople + byFarm;
  return { points, minted, byPeople, byFarm, served: people ? byPeople / people : 0, gaveUp };
}
