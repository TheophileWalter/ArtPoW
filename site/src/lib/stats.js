// Data of the statistics page, read from the contract and its events. Difficulty follows the token attribute:
// type(uint256).max / target, i.e. the expected number of hashes. Claim times come from the Claimed events, scanned
// in ranges the public RPC accepts; closed months are cached in the browser (they can no longer change).
import { contractAddress, deployBlock } from "./config.js";
import { Edition, abi, getAllMonths, getTokensData, publicClient, read } from "./contract.js";

export const FLOOR = 2 ** 28;
export const TARGET_PER_MONTH = 1000;
const MAX_UINT = 2n ** 256n - 1n;
const LOG_RANGE = 10_000n; // eth_getLogs block range accepted by public Polygon RPCs
const PARALLEL = 4;
// The public RPC balances requests across nodes that can lag a few blocks behind the newest one: stay behind the
// head, and retry a failed request once.
const HEAD_MARGIN = 8n;
const retry = async (f) => {
  try {
    return await f();
  } catch {
    await new Promise((r) => setTimeout(r, 1500));
    return f();
  }
};
const claimedEvent = abi.find((e) => e.type === "event" && e.name === "Claimed");

/** Difficulty of a target as a Number of expected hashes (the token's Difficulty attribute). */
export const difficultyOf = (target) => Number(MAX_UINT / (target > 0n ? target : 1n));

/** Everything that does not need event logs: months, tokens, holders, per-month aggregates. */
export async function loadOverview() {
  const [months, total] = await Promise.all([getAllMonths(), read("totalMinted").then(Number)]);
  const ids = Array.from({ length: total }, (_, i) => i + 1);
  const [data, owners] = await Promise.all([getTokensData(ids), getOwners(ids)]);
  const tokens = ids.map((id, i) => ({
    id,
    month: Number(data[i].month),
    number: Number(data[i].number),
    bits: Number(data[i].leadingZeroBits),
    edition: Number(data[i].edition),
    difficulty: Number(data[i].edition) === Edition.Mined ? difficultyOf(data[i].target) : 0,
    owner: owners[i],
  }));
  const perMonth = months.map((m) => {
    const mined = tokens.filter((t) => t.month === m.month && t.edition === Edition.Mined);
    const difficulties = mined.map((t) => t.difficulty);
    return {
      ...m,
      mined,
      proofs: tokens.filter((t) => t.month === m.month && t.edition !== Edition.Mined).length,
      avgDifficulty: difficulties.length ? difficulties.reduce((a, b) => a + b, 0) / difficulties.length : 0,
      maxDifficulty: difficulties.length ? Math.max(...difficulties) : 0,
      maxBits: mined.length ? Math.max(...mined.map((t) => t.bits)) : 0,
    };
  });
  return { months: perMonth, tokens };
}

async function getOwners(ids, batch = 500) {
  const out = [];
  for (let i = 0; i < ids.length; i += batch) {
    const part = ids.slice(i, i + batch).map(BigInt);
    const nft = { address: contractAddress, abi };
    out.push(...(publicClient.chain.contracts?.multicall3
      ? (await publicClient.multicall({ contracts: part.map((id) => ({ ...nft, functionName: "ownerOf", args: [id] })), allowFailure: true })).map((r) => r.result)
      : await Promise.all(part.map((id) => read("ownerOf", [id]).catch(() => undefined)))));
  }
  return out;
}

// --- Claim times ----------------------------------------------------------------------------------------------

const blockCache = new Map();
async function blockAt(number) {
  if (!blockCache.has(number)) blockCache.set(number, retry(() => publicClient.getBlock({ blockNumber: number })).then((b) => ({ number, time: Number(b.timestamp) })));
  return blockCache.get(number);
}

/** First block whose timestamp is >= `time`, by interpolation search between two known blocks. */
async function blockAtTime(time, lo, hi) {
  let a = await blockAt(lo);
  let b = await blockAt(hi);
  if (time <= a.time) return a;
  if (time > b.time) return b;
  while (b.number - a.number > 1n) {
    const guess = a.number + BigInt(Math.floor((Number(b.number - a.number) * (time - a.time)) / Math.max(1, b.time - a.time)));
    const mid = await blockAt(guess <= a.number ? a.number + 1n : guess >= b.number ? b.number - 1n : guess);
    if (mid.time >= time) b = mid;
    else a = mid;
    // Interpolation converges fast on regular block times; finish by bisection if it stalls.
    if (b.number - a.number > 1n && (mid.number === a.number + 1n || mid.number === b.number - 1n)) {
      const half = await blockAt((a.number + b.number) / 2n);
      if (half.time >= time) b = half;
      else a = half;
    }
  }
  return b;
}

const cacheKey = (month) => `artpow-claims:${publicClient.chain.id}:${contractAddress}:${month}`;

/**
 * Claim times of a month: [{ number, time }], sorted. Scans the Claimed events of the month's block range; times
 * are interpolated from the block numbers between the range's two ends (Polygon blocks are regular, so the error is
 * a few seconds). `onProgress(done, total)` reports the scanned share.
 */
export async function claimTimes(month, onProgress = () => {}) {
  if (month.status === "closed") {
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey(month.month)) || "null");
      if (cached) return cached;
    } catch {
      // no storage: scan again
    }
  }
  const latest = await retry(async () => publicClient.getBlock({ blockNumber: (await publicClient.getBlockNumber()) - HEAD_MARGIN }));
  const now = Number(latest.timestamp);
  if (now < Number(month.start)) return [];
  const first = await blockAtTime(Number(month.start), deployBlock || 1n, latest.number);
  const last = now >= Number(month.end) ? await blockAtTime(Number(month.end), first.number, latest.number) : { number: latest.number, time: now };
  const ranges = [];
  for (let from = first.number; from <= last.number; from += LOG_RANGE) ranges.push([from, from + LOG_RANGE - 1n > last.number ? last.number : from + LOG_RANGE - 1n]);
  const logs = [];
  let done = 0;
  for (let i = 0; i < ranges.length; i += PARALLEL) {
    const part = await Promise.all(
      ranges.slice(i, i + PARALLEL).map(([fromBlock, toBlock]) =>
        retry(() => publicClient.getLogs({ address: contractAddress, event: claimedEvent, args: { month: BigInt(month.month) }, fromBlock, toBlock }))),
    );
    part.forEach((l) => logs.push(...l));
    done += part.length;
    onProgress(done, ranges.length);
  }
  const span = Number(last.number - first.number) || 1;
  const timeOf = (block) => first.time + ((last.time - first.time) * Number(block - first.number)) / span;
  const claims = logs.map((l) => ({ number: Number(l.args.number), time: Math.round(timeOf(l.blockNumber)) })).sort((a, b) => a.number - b.number);
  if (month.status === "closed") {
    try {
      localStorage.setItem(cacheKey(month.month), JSON.stringify(claims));
    } catch {
      // full or blocked storage: the scan is simply repeated next time
    }
  }
  return claims;
}

/**
 * Hourly series of a month from its claims: cumulative mined tokens, the schedule, and the difficulty a claim faced
 * at that moment (in multiples of the floor), by the contract's rule. Stops at `now` for the running month.
 */
export function monthSeries(month, claims, now) {
  const start = Number(month.start);
  const duration = Number(month.end) - start;
  const until = Math.min(Number(month.end), now);
  const points = [];
  let k = 0;
  for (let t = start; ; t = Math.min(t + 3600, until)) {
    while (k < claims.length && claims[k].time <= t) k++;
    const scheduled = (TARGET_PER_MONTH * (t - start)) / duration;
    points.push({ day: (t - start) / 86400, minted: k, scheduled, difficulty: 2 ** (Math.max(0, k - scheduled) / 10) });
    if (t >= until) break;
  }
  return points;
}
