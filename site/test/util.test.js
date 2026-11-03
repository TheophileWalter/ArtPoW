import { test } from "node:test";
import assert from "node:assert/strict";
import { valueAt } from "../src/lib/chart.js";
import { aimTarget, decodeDataJson, leadingZeroBits } from "../src/lib/contract.js";
import { DAY, createCountdown, isJsonSafe, monthLabel, resolveUri, validateSchedule } from "../src/lib/util.js";

const NOW = 2_000_000_000;
const content = (over = {}) => ({
  label: "November 2026",
  artist: "Jane Doe",
  artistAddress: "0x0000000000000000000000000000000000000000",
  image: "ipfs://bafy",
  animationUrl: "",
  ...over,
});
const month = (start, end) => ({ start: BigInt(start), end: BigInt(end) });

test("validateSchedule accepts a valid new month", () => {
  const months = [month(NOW - 10 * DAY, NOW + 20 * DAY)];
  const problems = validateSchedule({ month: 2, start: NOW + 20 * DAY, end: NOW + 50 * DAY, content: content() }, months, NOW);
  assert.deepEqual(problems, []);
});

test("validateSchedule mirrors the contract rules", () => {
  const months = [month(NOW - 10 * DAY, NOW + 20 * DAY), month(NOW + 20 * DAY, NOW + 50 * DAY)];
  const check = (v) => validateSchedule({ content: content(), ...v }, months, NOW);
  assert.match(check({ month: 4, start: NOW + 60 * DAY, end: NOW + 90 * DAY }).join(), /between 1 and 3/);
  assert.match(check({ month: 1, start: NOW + DAY, end: NOW + 30 * DAY }).join(), /locked/);
  assert.match(check({ month: 3, start: NOW + 50 * DAY, end: NOW + 74 * DAY }).join(), /25 and 35 days/);
  assert.match(check({ month: 3, start: NOW + 50 * DAY, end: NOW + 86 * DAY }).join(), /25 and 35 days/);
  assert.match(check({ month: 3, start: NOW + 49 * DAY, end: NOW + 79 * DAY }).join(), /Overlaps month 2/);
  const withNext = [...months, month(NOW + 50 * DAY, NOW + 80 * DAY)];
  const edit = validateSchedule({ month: 2, start: NOW + 21 * DAY, end: NOW + 51 * DAY, content: content() }, withNext, NOW);
  assert.match(edit.join(), /Overlaps month 3/);
  assert.match(check({ month: 3, start: NOW - 1, end: NOW + 30 * DAY }).join(), /future/);
  assert.match(check({ month: 3, start: NOW + 50 * DAY, end: NOW + 80 * DAY, content: content({ label: "" }) }).join(), /label is required/);
  assert.match(check({ month: 3, start: NOW + 50 * DAY, end: NOW + 80 * DAY, content: content({ image: 'ipfs://x"' }) }).join(), /image: double quotes/);
  assert.match(check({ month: 3, start: NOW + 50 * DAY, end: NOW + 80 * DAY, content: content({ artistAddress: "0x12" }) }).join(), /artist address/);
  assert.deepEqual(check({ month: 3, start: NOW + 50 * DAY, end: NOW + 75 * DAY }), []); // 25 days exactly
  assert.deepEqual(check({ month: 3, start: NOW + 50 * DAY, end: NOW + 85 * DAY }), []); // 35 days exactly
});

test("isJsonSafe matches the contract check", () => {
  assert.ok(isJsonSafe("November 2026 • #1"));
  for (const bad of ['a"b', "a\\b", "a\nb", "a\u0000b", "a\u001fb"]) assert.ok(!isJsonSafe(bad), JSON.stringify(bad));
  assert.ok(isJsonSafe("a\u007fb"));
});

test("resolveUri", () => {
  assert.equal(resolveUri("ipfs://bafy/1.png"), "https://ipfs.io/ipfs/bafy/1.png");
  assert.equal(resolveUri("ipfs://ipfs/bafy"), "https://ipfs.io/ipfs/bafy");
  assert.equal(resolveUri("ar://abc"), "https://arweave.net/abc");
  assert.equal(resolveUri("https://x.org/a.png"), "https://x.org/a.png");
  assert.equal(resolveUri("data:image/png;base64,AA"), "data:image/png;base64,AA");
});

test("aimTarget applies 2^(-margin/10), rounding down", () => {
  const t = 1n << 228n;
  assert.equal(aimTarget(t, 0), t);
  const aim = aimTarget(t, 10);
  assert.ok(aim <= t / 2n && aim > (t / 2n) * 999_999n / 1_000_000n);
  const two = aimTarget(t, 2);
  assert.ok(Number((two * 1_000_000n) / t) / 1e6 - 0.870551 < 1e-6);
});

test("leadingZeroBits and decodeDataJson", () => {
  assert.equal(leadingZeroBits(1n << 255n), 0);
  assert.equal(leadingZeroBits(1n << 227n), 28);
  assert.equal(leadingZeroBits(0n), 256);
  const json = { name: "November 2026 • #1", attributes: [] };
  const uri = "data:application/json;base64," + Buffer.from(JSON.stringify(json)).toString("base64");
  assert.deepEqual(decodeDataJson(uri), json);
  assert.equal(monthLabel(Date.UTC(2026, 10, 1) / 1000), "November 2026");
});

test("validateSchedule rejects a data: image that is not an image", () => {
  const months = [month(NOW - 10 * DAY, NOW + 20 * DAY)];
  const start = NOW + 20 * DAY;
  const check = (image) => validateSchedule({ month: 2, start, end: start + 30 * DAY, content: { ...content(), image } }, months, NOW);
  assert.equal(check("data:image/svg+xml;base64,PHN2Zz4=").length, 0);
  assert.equal(check("ipfs://bafyexample").length, 0);
  assert.match(check("data:text/plain;base64,ZGF0YTppbWFnZQ==").join(" "), /not an image/);
});

test("the countdown ticks down steadily through a wobbling estimate", () => {
  const countdown = createCountdown();
  assert.equal(countdown(100, 0), 100);
  // The estimate goes back up a little: the countdown keeps going down, one second per second.
  assert.equal(countdown(100.5, 1), 99);
  assert.equal(countdown(99.8, 2), 98);
  // It drops below: followed at once.
  assert.equal(countdown(80, 3), 80);
  // It clearly leaves the countdown behind (harder target, slowed tab): followed too.
  assert.equal(countdown(200, 4), 200);
});

test("the countdown stops at zero", () => {
  const countdown = createCountdown();
  countdown(2, 0);
  assert.equal(countdown(3, 5), 0, "a few seconds of wobble do not bring it back from zero");
  assert.equal(countdown(0, 6), 0);
  assert.equal(countdown(0, 7), 0);
});

test("a chart's value follows the line between its points", () => {
  const line = [[0, 0], [30, 1000]];
  assert.equal(valueAt(line, 0), 0);
  assert.equal(valueAt(line, 3), 100);
  assert.equal(valueAt(line, 30), 1000);
  assert.equal(valueAt(line, 40), 1000, "past the end");
  assert.equal(valueAt([[2, 5], [4, 7]], 1), 5, "before the start");
  // A vertical step of a staircase series: the higher point is reached exactly at its x.
  assert.equal(valueAt([[0, 0], [1, 0], [1, 1], [2, 1]], 1), 0);
  assert.equal(valueAt([[0, 0], [1, 0], [1, 1], [2, 1]], 1.5), 1);
});
