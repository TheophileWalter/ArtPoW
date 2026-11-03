// Formatting, URI resolution and the client-side mirror of the contract's scheduling rules. No DOM access.
import { arweaveGateway, explorer, ipfsGateway } from "./config.js";
import { hasKey, lang, t } from "./i18n.js";

export const DAY = 86400;
export const MIN_MONTH_DURATION = 25 * DAY;
export const MAX_MONTH_DURATION = 35 * DAY;

/** Turns ipfs:// and ar:// URIs into gateway URLs; other URIs are returned unchanged. */
export function resolveUri(uri) {
  if (!uri) return "";
  if (uri.startsWith("ipfs://")) return ipfsGateway + uri.slice("ipfs://".length).replace(/^ipfs\//, "");
  if (uri.startsWith("ar://")) return arweaveGateway + uri.slice("ar://".length);
  return uri;
}

/** Short display form of a URI: data: URIs show their size, long URIs are cut in the middle. */
export function displayUri(uri) {
  if (!uri) return "";
  if (uri.startsWith("data:")) return `${uri.slice(0, uri.indexOf(",") > 0 ? Math.min(uri.indexOf(","), 30) : 30)}… (${(uri.length / 1024).toFixed(1)} KB)`;
  return uri.length > 64 ? `${uri.slice(0, 40)}…${uri.slice(-16)}` : uri;
}

export const shortAddress = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
export const addressUrl = (a) => (explorer ? `${explorer}/address/${a}` : "");
export const txUrl = (h) => (explorer ? `${explorer}/tx/${h}` : "");

export function formatDate(seconds) {
  return new Date(Number(seconds) * 1000).toLocaleString(lang, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatDuration(seconds) {
  let s = Math.max(0, Math.round(Number(seconds)));
  const d = Math.floor(s / DAY);
  s -= d * DAY;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  const [D, H, M, S] = ["unit.d", "unit.h", "unit.min", "unit.s"].map((k) => t(k));
  if (d > 0) return `${d} ${D} ${h} ${H}`;
  if (h > 0) return `${h} ${H} ${m} ${M}`;
  if (m > 0) return `${m} ${M} ${s - m * 60} ${S}`;
  return `${s} ${S}`;
}

/**
 * Time left that counts down steadily although the hash rate estimate wobbles: it only follows the estimate when it
 * drops below the countdown or clearly leaves it behind (the target changed, or the browser slowed the tab down).
 */
export function createCountdown() {
  let left = null;
  let updatedAt = 0;
  return (estimate, now) => {
    const ticked = left === null ? estimate : Math.max(0, left - (now - updatedAt));
    left = estimate < ticked || estimate > ticked * 1.1 + 5 ? estimate : ticked;
    updatedAt = now;
    return left;
  };
}

export function formatHashes(n) {
  const units = ["", "k", "M", "G", "T", "P", "E"];
  let i = 0;
  while (n >= 1000 && i < units.length - 1) {
    n /= 1000;
    i++;
  }
  return `${n.toLocaleString(lang, { maximumFractionDigits: n < 10 ? 2 : n < 100 ? 1 : 0 })} ${units[i]}`;
}

/** Same rule as the contract: no double quote, backslash or control character. */
export const isJsonSafe = (s) => !/["\\\u0000-\u001f]/.test(s);

/**
 * Mirrors the checks of scheduleMonth. `months` is the list from getAllMonths(); `month` the number being
 * scheduled (monthCount + 1 for a new month). Returns a list of human-readable problems (empty when valid).
 */
export function validateSchedule({ month, start, end, content }, months, now = Math.floor(Date.now() / 1000)) {
  const problems = [];
  const count = months.length;
  if (month < 1 || month > count + 1) problems.push(`Month must be between 1 and ${count + 1}.`);
  const existing = months[month - 1];
  if (existing && now >= Number(existing.start)) problems.push(`Month ${month} has started: it is locked.`);
  if (!(end > start)) problems.push("The end must be after the start.");
  else if (end - start < MIN_MONTH_DURATION || end - start > MAX_MONTH_DURATION) {
    problems.push(`Duration must be between 25 and 35 days (currently ${((end - start) / DAY).toFixed(2)} days).`);
  }
  if (!(start > now)) problems.push("The start must be in the future.");
  const previous = months[month - 2];
  if (previous && start < Number(previous.end)) problems.push(`Overlaps month ${month - 1}, which ends ${formatDate(previous.end)}.`);
  const next = months[month];
  if (next && end > Number(next.start)) problems.push(`Overlaps month ${month + 1}, which starts ${formatDate(next.start)}.`);
  if (!content.label) problems.push("The label is required.");
  if (!content.image) problems.push("The image is required.");
  // Stricter than the contract, which accepts any URI: an image stored as data: must be of an image type (catches
  // a text file holding a URI that was loaded as a file and encoded a second time).
  const imageType = /^data:([^;,]*)/.exec(content.image ?? "")?.[1];
  if (imageType !== undefined && !imageType.startsWith("image/")) {
    problems.push(`The image is a data: URI of type "${imageType || "none"}", not an image.`);
  }
  for (const field of ["label", "artist", "image", "animationUrl"]) {
    if (!isJsonSafe(content[field] ?? "")) problems.push(`${field}: double quotes, backslashes and control characters are not allowed.`);
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(content.artistAddress)) problems.push("The artist address is not a valid address (use 0x0…0 for none).");
  return problems;
}

/** English month label for a start date, e.g. "November 2026". */
export const monthLabel = (seconds) =>
  new Date(Number(seconds) * 1000).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/** Name of the contract's custom error behind a failed call, if any. */
export function errorName(err) {
  for (let e = err; e; e = e.cause) {
    const name = e.data?.errorName ?? e.errorName;
    if (name) return name;
  }
  return null;
}

/** Human message for a failed contract call (custom errors of the contract included), in the page's language. */
export function errorMessage(err) {
  const name = errorName(err);
  if (name) return hasKey(`error.${name}`) ? t(`error.${name}`) : name;
  return err?.shortMessage || err?.message || String(err);
}
