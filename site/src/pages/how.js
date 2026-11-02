// "How it works": the system explained for everyone, with a hashing demo, a month simulator and month
// scenarios computed with the contract's rule (src/lib/explainer.js).
import { keccak256, toHex } from "viem";
import { lineChart } from "../lib/chart.js";
import { BROWSER_RATE, HALF_LIFE, hashesNeeded, scheduled, simulateMonth } from "../lib/explainer.js";
import { formatNumber, t } from "../lib/i18n.js";
import { h, initLayout, render } from "../lib/layout.js";
import { formatDuration } from "../lib/util.js";

initLayout("how.html");
const app = document.getElementById("app");
const C1 = "var(--chart-1)";
const C2 = "var(--chart-2)";
const REF = "var(--chart-ref)";

const section = (title, ...children) => h("section", { class: "how-section" }, h("h2", {}, title), ...children);
const stat = (value, label) => h("div", { class: "stat" }, h("div", { class: "value" }, value), h("div", { class: "label" }, label));
const p = (key) => h("p", {}, t(key));

// --- 1. Lottery demo ------------------------------------------------------------------------------------------

function lotteryDemo() {
  const ZEROS = 3; // 12 bits: one ticket in 4,096
  const BATCH = 2000;
  let tried = 0;
  let winners = 0;
  let last = null;
  const triedEl = h("div", { class: "value" }, "0");
  const winnersEl = h("div", { class: "value" }, "0");
  const ratioEl = h("div", { class: "value" }, "-");
  const tickets = h("div", { class: "tickets", "aria-live": "polite" });
  const lastEl = h("p", { class: "mono muted" }, `${t("how.lottery.lastWinner")}: ${t("how.lottery.none")}`);
  const seed = crypto.getRandomValues(new Uint8Array(16));

  const ticket = (hash, win) => {
    const hex = hash.slice(2);
    const zeros = hex.match(/^0*/)[0].length;
    return h("div", { class: win ? "ticket win" : "ticket" }, h("span", { class: "zeros" }, hex.slice(0, zeros)), hex.slice(zeros, 40), "…");
  };
  const print = () => {
    const shown = [];
    for (let i = 0; i < BATCH; i++) {
      tried++;
      const hash = keccak256(toHex(new Uint8Array([...seed, ...new Uint8Array(new Float64Array([tried]).buffer)])));
      const win = hash.startsWith("0x" + "0".repeat(ZEROS));
      if (win) {
        winners++;
        last = hash;
      }
      if (win || i >= BATCH - 6) shown.push(ticket(hash, win));
    }
    triedEl.textContent = formatNumber(tried);
    winnersEl.textContent = formatNumber(winners);
    ratioEl.textContent = winners ? formatNumber(Math.round(tried / winners)) : "-";
    render(tickets, shown.slice(-8));
    lastEl.textContent = `${t("how.lottery.lastWinner")}: ${last ? `${last.slice(0, 26)}…` : t("how.lottery.none")}`;
  };
  const reset = () => {
    tried = winners = 0;
    last = null;
    triedEl.textContent = winnersEl.textContent = "0";
    ratioEl.textContent = "-";
    render(tickets);
    lastEl.textContent = `${t("how.lottery.lastWinner")}: ${t("how.lottery.none")}`;
  };
  return h(
    "div",
    { class: "card demo" },
    h("h3", {}, t("how.lottery.demoTitle")),
    h("p", { class: "muted" }, t("how.lottery.demoText")),
    h("div", { class: "row" },
      h("button", { type: "button", onclick: print }, t("how.lottery.print", { n: formatNumber(BATCH) })),
      h("button", { type: "button", class: "secondary", onclick: reset }, t("how.lottery.reset"))),
    h("div", { class: "stats", style: "margin-top:16px" },
      h("div", { class: "stat" }, triedEl, h("div", { class: "label" }, t("how.lottery.tried"))),
      h("div", { class: "stat" }, winnersEl, h("div", { class: "label" }, t("how.lottery.winners"))),
      h("div", { class: "stat" }, ratioEl, h("div", { class: "label" }, t("how.lottery.average")))),
    tickets,
    lastEl,
    h("p", { class: "muted" }, t("how.lottery.scale")),
  );
}

// --- 2. Difficulty over a month ---------------------------------------------------------------------------------

const YEAR = 365 * 86400;
const browserSeconds = (factor) => (hashesNeeded(0) * factor) / BROWSER_RATE;
const longTime = (seconds) => (seconds > YEAR ? `> 365 ${t("unit.d")}` : formatDuration(seconds));
const timesFloor = (factor) => `× ${factor < 10 ? formatNumber(factor, { maximumFractionDigits: 2 }) : formatNumber(Math.round(factor))}`;

function paceCalculator() {
  const people = h("input", { type: "range", min: 0, max: 5000, step: 100, value: 3000 });
  const gpus = h("input", { type: "range", min: 0, max: 20, step: 1, value: 0 });
  const peopleOut = h("output", {});
  const gpusOut = h("output", {});
  const tiles = h("div", { class: "stats stats-4" });
  const chartBox = h("div", {});
  let chart = null;

  const update = () => {
    const r = simulateMonth({ people: Number(people.value), gpus: Number(gpus.value) });
    const points = r.points.map((q) => ({ ...q, factor: 2 ** (Math.max(0, q.minted - q.scheduled) / HALF_LIFE) }));
    const peak = points.reduce((a, b) => (b.factor > a.factor ? b : a));
    peopleOut.textContent = formatNumber(Number(people.value));
    gpusOut.textContent = formatNumber(Number(gpus.value));
    render(
      tiles,
      stat(formatNumber(Math.round(r.minted)), t("how.month.total")),
      stat(timesFloor(peak.factor), t("how.pace.peak")),
      stat(longTime(browserSeconds(peak.factor)), t("how.pace.peakTime")),
      stat(`${formatNumber(Math.round(r.served * 100))} %`, t("how.month.served")),
    );
    const yMax = Math.max(1000, Math.ceil(r.minted / 250) * 250);
    // Whole powers of ten, at least up to × 10 so a flat curve still reads as "the floor".
    const decades = Math.max(1, Math.ceil(Math.log10(peak.factor)));
    const options = {
      legend: true,
      series: [
        { label: t("how.pace.series.minted"), color: C1, points: points.map((q) => [q.day, q.minted]) },
        { label: t("how.pace.series.difficulty"), color: C2, dash: "6 4", right: true, points: points.map((q) => [q.day, q.factor]) },
      ],
      x: { min: 0, max: 30, ticks: [0, 5, 10, 15, 20, 25, 30], format: (v) => formatNumber(v) },
      y: { min: 0, max: yMax, ticks: Array.from({ length: yMax / 250 + 1 }, (_, i) => i * 250), format: (v) => formatNumber(v) },
      y2: {
        min: 1,
        max: 10 ** decades,
        log: true,
        ticks: Array.from({ length: decades + 1 }, (_, i) => 10 ** i),
        format: (v) => `× ${formatNumber(v, { notation: "compact" })}`,
      },
      xLabel: t("how.month.xAxis"),
      yLabel: t("how.pace.yAxis"),
      y2Label: t("how.pace.y2Axis"),
      ariaLabel: t("how.pace.chartTitle"),
      tooltip: (x, [m, factor]) => [
        [t("how.month.day", { day: formatNumber(Math.round(x * 10) / 10) }), ""],
        [t("how.pace.series.minted"), formatNumber(Math.round(m)), C1],
        [t("how.pace.series.difficulty"), timesFloor(factor), C2],
        [t("how.month.series.line"), formatNumber(Math.round(scheduled(x)))],
      ],
    };
    if (chart) chart.update(options);
    else chart = lineChart(chartBox, options);
  };
  people.addEventListener("input", update);
  gpus.addEventListener("input", update);
  const box = h(
    "div",
    { class: "card demo" },
    h("div", { class: "grid2" },
      h("div", {}, h("label", {}, t("how.pace.people"), " · ", peopleOut), people),
      h("div", {}, h("label", {}, t("how.pace.gpus"), " · ", gpusOut), gpus)),
    tiles,
    h("h3", { style: "margin-top:20px" }, t("how.pace.chartTitle")),
    chartBox,
    h("p", { class: "muted chart-note" }, t("how.pace.chartNote")),
  );
  requestAnimationFrame(update);
  return box;
}

// --- 3. Month scenarios ---------------------------------------------------------------------------------------

const SCENARIOS = [
  ["quiet", { people: 300 }],
  ["busy", { people: 3000 }],
  ["gpu", { people: 300, gpus: 1 }],
  ["gpuLate", { people: 300, gpus: 1, gpuFrom: 25 }],
];

function monthScenarios() {
  const results = Object.fromEntries(SCENARIOS.map(([k, v]) => [k, simulateMonth(v)]));
  const chartBox = h("div", {});
  const tiles = h("div", { class: "stats" });
  const table = h("tbody", {});
  const buttons = SCENARIOS.map(([k]) => h("button", { type: "button", class: "secondary small", "aria-pressed": "false", onclick: () => select(k) }, t(`how.month.${k}`)));
  let chart = null;

  function select(key) {
    const r = results[key];
    buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(SCENARIOS[i][0] === key)));
    render(
      tiles,
      stat(formatNumber(Math.round(r.minted)), t("how.month.total")),
      stat(formatNumber(Math.round(r.byPeople)), t("how.month.people")),
      stat(formatNumber(Math.round(r.byFarm)), t("how.month.machines")),
      stat(`${formatNumber(Math.round(r.served * 100))} %`, t("how.month.served")),
    );
    const minted = r.points.map((q) => [q.day, q.minted]);
    const line = r.points.map((q) => [q.day, q.scheduled]);
    const yMax = Math.max(1200, Math.ceil(r.minted / 200) * 200);
    const options = {
      legend: true,
      series: [
        { label: t("how.month.series.minted"), color: C1, points: minted },
        { label: t("how.month.series.line"), color: REF, points: line, width: 1.5 },
      ],
      x: { min: 0, max: 30, ticks: [0, 5, 10, 15, 20, 25, 30], format: (v) => formatNumber(v) },
      y: { min: 0, max: yMax, ticks: Array.from({ length: yMax / 200 + 1 }, (_, i) => i * 200), format: (v) => formatNumber(v) },
      xLabel: t("how.month.xAxis"),
      yLabel: t("how.month.yAxis"),
      ariaLabel: t("how.month.title"),
      points: [{ x: 30, y: r.minted, color: C1, label: formatNumber(Math.round(r.minted)) }],
      tooltip: (x, [m, s]) => [
        [t("how.month.day", { day: formatNumber(Math.round(x * 10) / 10) }), ""],
        [t("how.month.series.minted"), formatNumber(Math.round(m)), C1],
        [t("how.month.series.line"), formatNumber(Math.round(s)), REF],
      ],
    };
    if (chart) chart.update(options);
    else chart = lineChart(chartBox, options);
    render(table, r.points.filter((q) => Math.abs(q.day % 3) < 1e-9).map((q) =>
      h("tr", {}, h("td", {}, formatNumber(q.day)), h("td", {}, formatNumber(Math.round(q.minted))), h("td", {}, formatNumber(Math.round(q.byPeople))), h("td", {}, formatNumber(Math.round(q.byFarm))), h("td", {}, formatNumber(Math.round(q.scheduled))))));
  }
  const box = h(
    "div",
    { class: "card demo" },
    h("div", { class: "row scenario-buttons" }, buttons),
    tiles,
    chartBox,
    h("p", { class: "muted chart-note" }, t("how.month.note")),
    h("details", {},
      h("summary", { class: "muted" }, t("how.month.table")),
      h("div", { class: "table-scroll" }, h("table", {},
        h("thead", {}, h("tr", {}, [t("how.month.tableDay"), t("how.month.series.minted"), t("how.month.people"), t("how.month.machines"), t("how.month.series.line")].map((c) => h("th", {}, c)))),
        table))),
  );
  requestAnimationFrame(() => select("quiet"));
  return box;
}

// --- Page -----------------------------------------------------------------------------------------------------

render(
  app,
  h("div", { class: "kicker", style: "margin-top:0" }, t("how.kicker")),
  h("h1", {}, t("how.title")),
  h("p", { class: "lead" }, t("how.lead")),

  section(t("how.idea.title"), h("div", { class: "card" }, h("ol", { class: "idea" }, [1, 2, 3, 4].map((i) => h("li", {}, t(`how.idea.${i}`)))))),

  section(t("how.lottery.title"), p("how.lottery.p1"), p("how.lottery.p2"), lotteryDemo()),

  section(t("how.steal.title"), p("how.steal.p1"), p("how.steal.p2")),

  section(
    t("how.pace.title"),
    p("how.pace.p1"),
    h("div", { class: "cards two" },
      h("div", { class: "card" }, h("p", {}, t("how.pace.ahead"))),
      h("div", { class: "card" }, h("p", {}, t("how.pace.behind")))),
    p("how.pace.p2"),
    paceCalculator(),
  ),

  section(t("how.month.title"), p("how.month.p1"), monthScenarios()),

  section(
    t("how.fair.title"),
    h("div", { class: "cards two" },
      h("div", { class: "card" }, h("h3", {}, t("how.fair.yesTitle")), h("ul", { class: "checks yes" }, [1, 2, 3, 4].map((i) => h("li", {}, t(`how.fair.yes${i}`))))),
      h("div", { class: "card" }, h("h3", {}, t("how.fair.noTitle")), h("ul", { class: "checks no" }, [1, 2, 3].map((i) => h("li", {}, t(`how.fair.no${i}`)))))),
  ),

  section(t("how.faq.title"), h("div", { class: "faq" }, [1, 2, 3, 4, 5, 6].map((i) => h("details", { class: "card" }, h("summary", {}, t(`how.faq.q${i}`)), h("p", { class: "muted" }, t(`how.faq.a${i}`)))))),

  h("div", { class: "row", style: "margin-top:32px" },
    h("a", { class: "button", href: "mine.html" }, t("how.cta.mine")),
    h("a", { class: "button secondary", href: "whitepaper.html" }, t("how.cta.whitepaper"))),
);
