// Statistics: collection-wide figures, tokens per month, rarity distribution, and for every month the tokens minted
// against the schedule and the difficulty over time. Everything is read live from the contract and its events.
import { barChart, lineChart } from "../lib/chart.js";
import { TYPICAL_BROWSER_HASHRATE } from "../lib/config.js";
import { formatNumber, lang, t, tn } from "../lib/i18n.js";
import { h, initLayout, render } from "../lib/layout.js";
import { FLOOR, TARGET_PER_MONTH, claimTimes, loadOverview, monthSeries } from "../lib/stats.js";
import { errorMessage, formatDate, formatDuration, formatHashes } from "../lib/util.js";

initLayout("stats.html");
const app = document.getElementById("app");
const C1 = "var(--chart-1)";
const REF = "var(--chart-ref)";

const factor = (d) => (d <= 0 ? "-" : `× ${formatNumber(d / FLOOR, { maximumFractionDigits: d / FLOOR < 10 ? 2 : 0 })}`);
const browserTime = (hashes) => formatDuration(hashes / TYPICAL_BROWSER_HASHRATE);
const tile = (value, label, sub) => h("div", { class: "stat" }, h("div", { class: "value" }, value), h("div", { class: "label" }, label), sub ? h("div", { class: "sub" }, sub) : null);
const tokenName = (tok, months) => `${months[tok.month - 1]?.content.label ?? ""} • #${tok.number}`;
const lower = (text) => text.toLocaleLowerCase(lang);
const status = (m) => (m.status === "active" ? t("common.live") : t(`status.${m.status}`));

function overviewTiles({ months, tokens }) {
  const mined = tokens.filter((x) => x.difficulty > 0);
  const closed = months.filter((m) => m.status === "closed");
  const current = months.find((m) => m.status === "active");
  const avgClosed = closed.length ? closed.reduce((a, m) => a + m.mined.length, 0) / closed.length : null;
  const avgDifficulty = mined.length ? mined.reduce((a, x) => a + x.difficulty, 0) / mined.length : 0;
  const record = mined.reduce((a, x) => (!a || x.difficulty > a.difficulty ? x : a), null);
  const rarest = mined.reduce((a, x) => (!a || x.bits > a.bits ? x : a), null);
  const work = mined.reduce((a, x) => a + x.difficulty, 0);
  const holders = new Set(tokens.map((x) => x.owner?.toLowerCase()).filter(Boolean)).size;
  return h(
    "div",
    { class: "stats stats-grid" },
    tile(formatNumber(months.length), t("stats.months"), t("stats.monthsSub", { closed: formatNumber(closed.length), current: current ? current.content.label : "-" })),
    tile(formatNumber(tokens.length), t("stats.tokens"), t("stats.tokensSub", { mined: formatNumber(mined.length), proofs: formatNumber(tokens.length - mined.length) })),
    tile(avgClosed === null ? "-" : formatNumber(Math.round(avgClosed)), t("stats.avgPerMonth"), avgClosed === null ? t("stats.noClosedMonth") : t("stats.avgPerMonthSub", { n: formatNumber(closed.length) })),
    tile(factor(avgDifficulty), t("stats.avgDifficulty"), avgDifficulty ? t("stats.hashesSub", { hashes: formatHashes(avgDifficulty), time: browserTime(avgDifficulty) }) : null),
    tile(record ? factor(record.difficulty) : "-", t("stats.record"), record ? t("stats.recordSub", { name: tokenName(record, months), id: record.id }) : null),
    tile(rarest ? formatNumber(rarest.bits) : "-", t("stats.rarest"), rarest ? t("stats.recordSub", { name: tokenName(rarest, months), id: rarest.id }) : null),
    tile(formatHashes(work), t("stats.work"), t("stats.workSub", { time: browserTime(work) })),
    tile(formatNumber(holders), t("stats.holders"), tn("stats.holdersSub", tokens.length)),
  );
}

function perMonthBars(container, months) {
  const top = Math.max(TARGET_PER_MONTH * 1.25, ...months.map((m) => m.mined.length));
  const step = top > 2000 ? 500 : 250;
  const max = Math.ceil(top / step) * step;
  barChart(container, {
    bars: months.map((m) => ({ label: m.content.label.replace(/^(\w{3})\w*\s+(\d{2})(\d{2})$/, "$1 $3"), value: m.mined.length, month: m })),
    color: C1,
    y: { max, ticks: Array.from({ length: max / step + 1 }, (_, i) => i * step), format: (v) => formatNumber(v) },
    reference: { value: TARGET_PER_MONTH, label: t("stats.target") },
    tooltip: (b) => [[b.month.content.label, ""], [t("stats.minedTokens"), formatNumber(b.value)], [t("stats.avgDifficulty"), factor(b.month.avgDifficulty)]],
    ariaLabel: t("stats.perMonthTitle"),
  });
}

function rarityBars(container, tokens) {
  const mined = tokens.filter((x) => x.difficulty > 0);
  const lo = 28;
  const hi = Math.max(lo + 4, ...mined.map((x) => x.bits));
  const counts = Array.from({ length: hi - lo + 1 }, (_, i) => mined.filter((x) => x.bits === lo + i).length);
  const top = Math.max(1, ...counts);
  const step = top <= 5 ? 1 : top <= 50 ? 10 : top <= 500 ? 100 : 500;
  const max = Math.ceil(top / step) * step;
  barChart(container, {
    bars: counts.map((value, i) => ({ label: String(lo + i), value, bits: lo + i })),
    color: C1,
    y: { max, ticks: Array.from({ length: max / step + 1 }, (_, i) => i * step), format: (v) => formatNumber(v) },
    tooltip: (b) => [[t("stats.zeroBits", { n: b.bits }), ""], [t("stats.minedTokens"), formatNumber(b.value)], [t("stats.odds"), t("stats.oddsValue", { n: formatNumber(2 ** (b.bits - 28)) })]],
    ariaLabel: t("stats.rarityTitle"),
  });
}

function monthTable(months) {
  const cols = ["stats.col.month", "stats.col.artist", "stats.col.dates", "stats.col.status", "stats.col.mined", "stats.col.proofs", "stats.col.avg", "stats.col.record", "stats.col.rarest"];
  return h("div", { class: "table-scroll" }, h("table", { class: "stats-table" },
    h("thead", {}, h("tr", {}, cols.map((c) => h("th", {}, t(c))))),
    h("tbody", {}, [...months].reverse().map((m) => h("tr", {},
      h("td", {}, h("a", { href: `#month-${m.month}` }, m.content.label)),
      h("td", {}, m.content.artist || "-"),
      h("td", { class: "nowrap" }, `${formatDate(m.start)} → ${formatDate(m.end)}`),
      h("td", {}, h("span", { class: `status ${m.status}` }, status(m))),
      h("td", { class: "num" }, formatNumber(m.mined.length)),
      h("td", { class: "num" }, formatNumber(m.proofs)),
      h("td", { class: "num" }, factor(m.avgDifficulty)),
      h("td", { class: "num" }, factor(m.maxDifficulty)),
      h("td", { class: "num" }, m.maxBits ? formatNumber(m.maxBits) : "-"))))));
}

const powersOfTwo = (max) => {
  const ticks = [1];
  while (ticks.at(-1) < max) ticks.push(ticks.at(-1) * (max > 1024 ? 16 : max > 64 ? 4 : 2));
  return ticks;
};

/** One month: figures, tokens against the schedule, difficulty over time. Charts load once the claims are read. */
function monthSection(m) {
  const body = h("div", {}, h("p", { class: "muted" }, t("stats.reading")));
  const days = (Number(m.end) - Number(m.start)) / 86400;
  const section = h(
    "section",
    { class: "card month-stats", id: `month-${m.month}` },
    h("div", { class: "month-stats-head" }, h("h3", {}, m.content.label), h("span", { class: `status ${m.status}` }, status(m))),
    h("p", { class: "muted" }, [m.content.artist ? `${t("common.by")} ${m.content.artist} · ` : "", `${formatDate(m.start)} → ${formatDate(m.end)}`].join("")),
    h("div", { class: "stats" },
      tile(formatNumber(m.mined.length), t("stats.minedTokens")),
      tile(formatNumber(m.proofs), lower(t("stats.col.proofs"))),
      tile(factor(m.avgDifficulty), lower(t("stats.col.avg"))),
      tile(factor(m.maxDifficulty), lower(t("stats.col.record")))),
    body,
  );
  const load = async () => {
    if (m.status === "upcoming") return render(body, h("p", { class: "muted" }, t("stats.notStarted", { date: formatDate(m.start) })));
    try {
      const claims = await claimTimes(m, (done, total) => (body.firstChild.textContent = t("stats.readingPct", { pct: Math.round((done / total) * 100) })));
      const now = Math.floor(Date.now() / 1000);
      const series = monthSeries(m, claims, now);
      const tokensBox = h("div", {});
      const difficultyBox = h("div", {});
      render(body,
        h("h4", {}, t("stats.tokensChart")), tokensBox,
        h("h4", {}, t("stats.difficultyChart")), difficultyBox,
        h("p", { class: "muted chart-note" }, m.status === "active" ? t("stats.runningNote") : t("stats.closedNote", { n: formatNumber(m.mined.length) })));
      const dayTicks = Array.from({ length: Math.floor(days / 5) + 1 }, (_, i) => i * 5);
      const x = { min: 0, max: days, ticks: dayTicks, format: (v) => formatNumber(v) };
      const yTop = Math.max(TARGET_PER_MONTH, ...series.map((p) => p.minted));
      const yStep = yTop > 2000 ? 500 : 250;
      const yMax = Math.ceil(yTop / yStep) * yStep;
      const dayLabel = (d) => t("how.month.day", { day: formatNumber(Math.round(d * 10) / 10) });
      lineChart(tokensBox, {
        legend: true,
        height: 220,
        series: [
          { label: t("stats.series.minted"), color: C1, points: series.map((p) => [p.day, p.minted]) },
          { label: t("stats.series.expected"), color: REF, width: 1.5, points: [[0, 0], [days, TARGET_PER_MONTH]] },
        ],
        x,
        y: { min: 0, max: yMax, ticks: Array.from({ length: yMax / yStep + 1 }, (_, i) => i * yStep), format: (v) => formatNumber(v) },
        xLabel: t("how.month.xAxis"),
        ariaLabel: t("stats.tokensChart"),
        tooltip: (d, [minted]) => [[dayLabel(d), ""], [t("stats.series.minted"), formatNumber(minted), C1], [t("stats.series.expected"), formatNumber(Math.round((TARGET_PER_MONTH * d) / days)), REF]],
      });
      const dMax = Math.max(2, ...series.map((p) => p.difficulty));
      const ticks = powersOfTwo(dMax);
      lineChart(difficultyBox, {
        height: 200,
        series: [{ label: t("stats.series.difficulty"), color: C1, points: series.map((p) => [p.day, p.difficulty]) }],
        x,
        y: { min: 1, max: ticks.at(-1), log: true, ticks, format: (v) => `× ${formatNumber(v)}` },
        xLabel: t("how.month.xAxis"),
        ariaLabel: t("stats.difficultyChart"),
        tooltip: (d, [diff]) => [[dayLabel(d), ""], [t("stats.series.difficulty"), `× ${formatNumber(diff, { maximumFractionDigits: 2 })}`, C1], [t("how.pace.time"), browserTime(diff * FLOOR)]],
      });
    } catch (err) {
      console.error(err);
      render(body, h("div", { class: "notice warn" }, t("stats.cannotReadClaims", { error: errorMessage(err) })));
    }
  };
  return { section, load };
}

async function main() {
  let data;
  try {
    data = await loadOverview();
  } catch (err) {
    console.error(err);
    return render(app, h("div", { class: "notice warn" }, t("common.cannotRead", { error: errorMessage(err) })));
  }
  const perMonthBox = h("div", {});
  const rarityBox = h("div", {});
  const sections = [...data.months].reverse().map(monthSection);
  render(
    app,
    h("div", { class: "kicker", style: "margin-top:0" }, t("stats.kicker")),
    h("h1", {}, t("stats.title")),
    h("p", { class: "lead" }, t("stats.lead")),
    overviewTiles(data),
    data.months.length
      ? h("div", { class: "cards two", style: "margin-top:24px" },
        h("div", { class: "card" }, h("h3", {}, t("stats.perMonthTitle")), perMonthBox),
        h("div", { class: "card" }, h("h3", {}, t("stats.rarityTitle")), rarityBox, h("p", { class: "muted chart-note" }, t("stats.rarityNote"))))
      : h("p", { class: "muted" }, t("home.noEdition")),
    data.months.length ? h("h2", {}, t("stats.tableTitle")) : null,
    data.months.length ? monthTable(data.months) : null,
    data.months.length ? h("h2", {}, t("stats.monthsTitle")) : null,
    sections.map((s) => s.section),
  );
  if (data.months.length) {
    perMonthBars(perMonthBox, data.months);
    rarityBars(rarityBox, data.tokens);
  }
  // Newest month first; one at a time so that the public RPC is not flooded.
  for (const s of sections) await s.load();
}

main();
