// Home page: presentation and the current month.
import { TYPICAL_BROWSER_HASHRATE } from "../lib/config.js";
import { expectedHashes, getAllMonths, read } from "../lib/contract.js";
import { t } from "../lib/i18n.js";
import { h, initLayout, render } from "../lib/layout.js";
import { errorMessage, formatDate, formatDuration, resolveUri } from "../lib/util.js";

initLayout("./");
const app = document.getElementById("app");

const steps = ["mine", "claim", "collect"].map((k) => [t(`home.step.${k}`), t(`home.step.${k}Text`)]);
const facts = ["free", "self", "onchain", "royalties"].map((k) => [t(`home.fact.${k}`), t(`home.fact.${k}Text`)]);

function artwork(m) {
  const now = Math.floor(Date.now() / 1000);
  return h(
    "div",
    { class: "art-frame" },
    h("img", { class: "artwork", src: resolveUri(m.content.image), alt: m.content.label }),
    h(
      "div",
      { class: "art-caption" },
      h("span", {}, `${m.content.label}${m.content.artist ? ` · ${m.content.artist}` : ""}`),
      m.status === "active"
        ? h("span", { class: "status active" }, t("home.liveLeft", { time: formatDuration(Number(m.end) - now) }))
        : h("span", { class: "status upcoming" }, t("home.opensIn", { time: formatDuration(Number(m.start) - now) })),
    ),
  );
}

const terminal = () =>
  h(
    "div",
    { class: "terminal" },
    h("div", { class: "bar" }, h("i"), h("i"), h("i"), h("span", { style: "margin-left:8px" }, "ArtPoW.sol")),
    h(
      "pre",
      {},
      h("span", { class: "c" }, `${t("home.code.valid")}\n`),
      h("span", { class: "k" }, "keccak256"),
      "(abi.encode(seed, month, recipient, nonce))\n    < ",
      h("span", { class: "s" }, "target"),
      "\n\n",
      h("span", { class: "c" }, `${t("home.code.schedule")}\n`),
      h("span", { class: "s" }, "target"),
      " = floor × 2^((schedule − minted) / 10)",
    ),
  );

async function load() {
  let months = [];
  let active = 0;
  let target = 0n;
  try {
    [months, active] = await Promise.all([getAllMonths(), read("activeMonth").then(Number)]);
    if (active) target = await read("currentTarget", [BigInt(active)]);
  } catch (err) {
    console.error(err);
    render(app, h("div", { class: "notice warn" }, t("common.cannotRead", { error: errorMessage(err) })));
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  const current = active ? months[active - 1] : months.find((m) => m.status === "upcoming");

  let statusBlock;
  if (active) {
    const seconds = expectedHashes(target) / TYPICAL_BROWSER_HASHRATE;
    statusBlock = h(
      "div",
      {},
      h(
        "div",
        { class: "stats" },
        h("div", { class: "stat" }, h("div", { class: "value" }, String(current.minted)), h("div", { class: "label" }, t("common.minted"))),
        h("div", { class: "stat" }, h("div", { class: "value" }, formatDuration(Number(current.end) - now)), h("div", { class: "label" }, t("common.left"))),
        h("div", { class: "stat" }, h("div", { class: "value" }, `~${formatDuration(seconds)}`), h("div", { class: "label" }, t("home.toMine"))),
      ),
      h("div", { class: "row" }, h("a", { class: "button", href: "mine" }, t("home.mineCta")), h("a", { class: "button secondary", href: "gallery" }, t("home.gallery"))),
    );
  } else if (current) {
    statusBlock = h("div", { class: "row" }, h("span", { class: "muted" }, t("home.nextOpens", { date: formatDate(current.start) })), h("a", { class: "button secondary", href: "gallery" }, t("home.pastEditions")));
  } else {
    statusBlock = h("p", { class: "muted" }, t("home.noEdition"));
  }

  render(
    app,
    h(
      "section",
      { class: "hero" },
      h(
        "div",
        {},
        h("div", { class: "chips" }, h("span", { class: "badge" }, h("span", { class: "dot" }), t("home.chip.free")), h("span", { class: "badge" }, t("home.chip.pow")), h("span", { class: "badge" }, t("home.chip.royalties")), h("span", { class: "badge" }, t("home.chip.open"))),
        h("h1", {}, t("home.title1"), h("br"), h("span", { class: "gradient-text" }, t("home.title2"))),
        h("p", { class: "lead" }, t("home.lead")),
        h("div", { class: "row audience" }, h("a", { class: "button", href: "mine" }, t("home.collector")), h("a", { class: "button", href: "artists" }, t("home.artist"))),
        statusBlock,
      ),
      current ? artwork(current) : terminal(),
    ),
    h("div", { class: "kicker" }, t("home.howKicker")),
    h("h2", {}, t("home.howTitle")),
    h("div", { class: "steps" }, steps.map(([title, text]) => h("div", { class: "card" }, h("h3", {}, title), h("p", { class: "muted" }, text)))),
    h("p", { style: "margin-top:16px" }, h("a", { href: "how" }, t("home.howLink"))),
    h("div", { class: "kicker" }, t("home.rulesKicker")),
    h("h2", {}, t("home.rulesTitle")),
    h(
      "div",
      { class: "hero" },
      h("div", { class: "cards", style: "grid-template-columns:repeat(auto-fill,minmax(min(100%,220px),1fr))" },
        facts.map(([title, text]) => h("div", { class: "card feature" }, h("h3", {}, h("span", { class: "icon" }, "▸"), title), h("p", { class: "muted" }, text)))),
      terminal(),
    ),
    h("div", { class: "kicker" }, t("home.readKicker")),
    h("h2", {}, t("home.readTitle")),
    h("p", { class: "muted" }, t("home.readText")),
    h("a", { class: "button secondary", href: "whitepaper" }, t("home.readCta")),
    h("div", { class: "kicker" }, t("home.artistsKicker")),
    h("h2", {}, t("home.artistsTitle")),
    h("p", { class: "muted" }, t("home.artistsText")),
    h("a", { class: "button secondary", href: "artists" }, t("home.artistsCta")),
  );
}

load();
