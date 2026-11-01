// Gallery: every month's edition, a token viewer and the tokens of the connected wallet.
import { Edition, getAllMonths, getToken, getTokensData, getTokensOf, read } from "../lib/contract.js";
import { formatNumber, t, tn } from "../lib/i18n.js";
import { h, initLayout, notify, render } from "../lib/layout.js";
import { addressUrl, errorMessage, formatDate, resolveUri, shortAddress } from "../lib/util.js";
import { account } from "../lib/wallet.js";

initLayout("gallery.html");
const app = document.getElementById("app");
const viewer = h("div", { id: "viewer", style: "margin-top:20px" });
const mine = h("div", {});
let months = [];

function monthCard(m) {
  const c = m.content;
  const open = () => showMonth(m);
  return h(
    "div",
    {
      class: "card month-card clickable",
      role: "button",
      tabindex: "0",
      "aria-label": t("gallery.show.month", { label: c.label }),
      onclick: (e) => !e.target.closest("a") && open(),
      onkeydown: (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open()),
    },
    h("img", { class: "artwork", src: resolveUri(c.image), alt: c.label, loading: "lazy" }),
    h("div", { class: "meta" }, h("span", {}, `#${String(m.month).padStart(2, "0")}`), h("span", { class: `status ${m.status}` }, m.status === "active" ? t("common.live") : t(`status.${m.status}`))),
    h("h3", { style: "margin-top:8px" }, c.label),
    c.artist ? h("p", { class: "muted", style: "margin-bottom:6px" }, `${t("common.by")} `, h("strong", { style: "color:var(--text)" }, c.artist)) : null,
    h("div", { class: "meta" }, h("span", {}, m.status === "upcoming" ? t("gallery.opens", { date: formatDate(m.start) }) : t("gallery.mintedCount", { n: formatNumber(m.minted) })), c.animationUrl ? h("a", { href: resolveUri(c.animationUrl), target: "_blank", rel: "noopener" }, t("gallery.animation")) : null),
  );
}

/**
 * Tokens of a month: ids are contiguous because months never overlap, so a month starts after every token of the
 * months before it (mined tokens and proofs).
 */
async function monthTokenIds(m) {
  const before = months.filter((x) => x.month < m.month);
  const proofs = await Promise.all([...before, m].map((x) => read("proofsMinted", [BigInt(x.month)])));
  const count = (x, [artist, team]) => Number(x.minted) + (artist ? 1 : 0) + (team ? 1 : 0);
  const first = 1 + before.reduce((sum, x, i) => sum + count(x, proofs[i]), 0);
  return Array.from({ length: count(m, proofs.at(-1)) }, (_, i) => first + i);
}

async function showMonth(m) {
  const c = m.content;
  const tokens = h("p", { class: "muted" }, t("gallery.listing"));
  render(
    viewer,
    h(
      "div",
      { class: "card hero top" },
      h("div", { class: "art-frame" }, h("img", { class: "artwork", src: resolveUri(c.image), alt: c.label })),
      h(
        "div",
        {},
        h("h2", { style: "margin-top:0" }, c.label),
        c.artist ? h("p", {}, `${t("common.by")} `, h("strong", {}, c.artist)) : null,
        h("p", { class: "muted" }, `${formatDate(m.start)} → ${formatDate(m.end)}`),
        h("p", {}, h("span", { class: `status ${m.status}` }, m.status === "active" ? t("common.live") : t(`status.${m.status}`)), ` · ${t("gallery.mined", { n: formatNumber(m.minted) })}`),
        c.animationUrl ? h("p", {}, h("a", { href: resolveUri(c.animationUrl), target: "_blank", rel: "noopener" }, t("gallery.openAnimation"))) : null,
        h("h3", { style: "margin-top:16px" }, t("gallery.tokensTitle")),
        tokens,
      ),
    ),
  );
  history.replaceState(null, "", `#month=${m.month}`);
  viewer.scrollIntoView({ behavior: "smooth" });
  try {
    const ids = await monthTokenIds(m);
    const data = ids.length ? await getTokensData(ids) : [];
    // Proofs first, then mined tokens by edition number; the token id stays in the tooltip.
    const list = ids.map((id, i) => ({ id, data: data[i], proof: Number(data[i].edition) !== Edition.Mined }))
      .sort((a, b) => b.proof - a.proof || Number(a.data.number) - Number(b.data.number));
    render(
      tokens,
      list.length
        ? h("div", { class: "row token-list" }, list.map(({ id, data, proof }) =>
          h("button", { class: `secondary small${proof ? " proof" : ""}`, type: "button", title: t("gallery.tokenId", { id }), onclick: () => showToken(id) }, editionLabel(data))))
        : h("span", { class: "muted" }, m.status === "upcoming" ? t("gallery.notOpen") : t("gallery.noToken")),
    );
  } catch (err) {
    render(tokens, h("span", { class: "muted" }, t("gallery.cannotList", { error: errorMessage(err) })));
  }
}

async function showToken(id) {
  render(viewer, h("p", { class: "muted" }, t("gallery.loadingToken", { id })));
  try {
    const { owner, metadata } = await getToken(id);
    const media = h("div", { class: "art-frame" }, h("img", { class: "artwork", src: resolveUri(metadata.image), alt: metadata.name }));
    render(
      viewer,
      h(
        "div",
        { class: "card hero top" },
        media,
        h(
          "div",
          {},
          h("h2", { style: "margin-top:0" }, metadata.name),
          h("p", {}, t("gallery.owner"), h("a", { href: addressUrl(owner), target: "_blank", rel: "noopener" }, shortAddress(owner))),
          metadata.animation_url ? h("p", {}, h("a", { href: resolveUri(metadata.animation_url), target: "_blank", rel: "noopener" }, t("gallery.openAnimation"))) : null,
          metadata.external_url ? h("p", {}, h("a", { href: metadata.external_url, target: "_blank", rel: "noopener" }, t("gallery.tokenPage"))) : null,
          h(
            "div",
            { class: "attributes" },
            metadata.attributes.map((a) =>
              h("div", { class: "attribute" }, h("div", { class: "label" }, a.trait_type), h("div", { class: "value" }, a.trait_type === "Difficulty" ? Number(a.value).toExponential(2) : String(a.value))),
            ),
          ),
        ),
      ),
    );
    history.replaceState(null, "", `#token=${id}`);
    viewer.scrollIntoView({ behavior: "smooth" });
  } catch (err) {
    render(viewer, h("div", { class: "notice warn" }, t("gallery.tokenError", { id, error: errorMessage(err) })));
  }
}

/** Name of a token within its month, like the NFT: edition number for mined tokens, the proof's kind otherwise. */
const editionLabel = (data) =>
  Number(data.edition) === Edition.ArtistProof ? t("gallery.edition.artist")
    : Number(data.edition) === Edition.TeamProof ? t("gallery.edition.team")
      : `#${data.number}`;

/** Small card of a token in "My tokens": the month's artwork, the token id, the month and the edition. */
function tokenCard(id, data) {
  const m = months[Number(data.month) - 1];
  // The id comes second: it also counts the proofs, so it differs from the edition number.
  const edition = editionLabel(data);
  const open = () => showToken(id);
  return h(
    "div",
    {
      class: "card token-card clickable",
      role: "button",
      tabindex: "0",
      "aria-label": `${m?.content.label ?? ""} • ${edition}`,
      onclick: open,
      onkeydown: (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open()),
    },
    m ? h("img", { class: "artwork", src: resolveUri(m.content.image), alt: m.content.label, loading: "lazy" }) : null,
    h("div", { class: "token-card-text" },
      h("strong", {}, `${m?.content.label ?? ""} • ${edition}`),
      h("span", { class: "muted" }, t("gallery.tokenId", { id }))),
  );
}

async function findMine() {
  const address = account().address;
  if (!address) return notify(t("gallery.connectFirst"), "error");
  const status = h("p", { class: "muted" }, t("gallery.scanning"));
  render(mine, status);
  try {
    const ids = await getTokensOf(address, (done, total) => {
      status.textContent = t("gallery.scanningPct", { pct: total ? Math.round((done / total) * 100) : 100 });
    });
    if (!ids.length) return render(mine, h("p", { class: "muted mine-empty" }, t("gallery.noneInWallet")));
    const data = await getTokensData(ids);
    render(
      mine,
      h("h3", { class: "mine-title" }, t("gallery.yourTokens"), h("span", { class: "badge" }, formatNumber(ids.length))),
      h("div", { class: "token-cards" }, ids.map((id, i) => tokenCard(id, data[i]))),
    );
  } catch (err) {
    render(mine, h("div", { class: "notice warn" }, t("gallery.cannotListMine", { error: errorMessage(err) })));
  }
}

async function load() {
  let total;
  try {
    [months, total] = await Promise.all([getAllMonths(), read("totalMinted").then(Number)]);
  } catch (err) {
    render(app, h("div", { class: "notice warn" }, t("common.cannotRead", { error: errorMessage(err) })));
    return;
  }
  const idInput = h("input", { type: "number", min: 1, max: Math.max(total, 1), placeholder: t("gallery.lookupPlaceholder"), style: "max-width:240px" });
  render(
    app,
    h("div", { class: "kicker", style: "margin-top:0" }, t("gallery.kicker")),
    h("h1", {}, t("gallery.title")),
    h("div", { class: "chips" }, h("span", { class: "badge" }, tn("gallery.editions", months.length)), h("span", { class: "badge" }, tn("gallery.tokens", total))),
    h("h2", { style: "margin-top:24px" }, t("gallery.lookup")),
    h(
      "form",
      { class: "row", onsubmit: (e) => { e.preventDefault(); if (idInput.value) showToken(Number(idInput.value)); } },
      idInput,
      h("button", { type: "submit" }, t("gallery.show")),
      h("button", { type: "button", class: "secondary", onclick: findMine }, t("gallery.mine")),
    ),
    mine,
    viewer,
    h("div", { class: "kicker" }, t("gallery.editionsKicker")),
    h("h2", {}, t("gallery.everyMonth")),
    months.length ? h("div", { class: "cards" }, [...months].reverse().map(monthCard)) : h("p", { class: "muted" }, t("gallery.noEdition")),
  );
  const fromHash = /token=(\d+)/.exec(location.hash);
  const monthHash = /month=(\d+)/.exec(location.hash);
  if (fromHash) showToken(Number(fromHash[1]));
  else if (monthHash && months[Number(monthHash[1]) - 1]) showMonth(months[Number(monthHash[1]) - 1]);
}

load();
