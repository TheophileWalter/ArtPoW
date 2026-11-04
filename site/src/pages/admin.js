// Administration page: every administrator function of the contract, as a form. Each action can be sent from
// the connected wallet, or exported as calldata for a multisig (e.g. Safe transaction builder).
import { getAddress, isAddress, parseEther } from "viem";
import { chain, contractAddress } from "../lib/config.js";
import { ADMIN_ROLE, Edition, chainNow, getAdmins, getAllMonths, getOverview, read } from "../lib/contract.js";
import { h, initLayout, notify, render } from "../lib/layout.js";
import {
  DAY,
  addressUrl,
  errorMessage,
  formatDate,
  isJsonSafe,
  monthLabel,
  displayUri,
  resolveUri,
  shortAddress,
  validateSchedule,
} from "../lib/util.js";
import { account, calldata, onAccountChange, write } from "../lib/wallet.js";

initLayout("admin");
const app = document.getElementById("app");
let data = null; // { overview, months, admins, isAdmin, isProposed, now }
let loadedAt = Date.now();

// --- Helpers -----------------------------------------------------------------------------------------------

const toUtcInput = (seconds) => new Date(Number(seconds) * 1000).toISOString().slice(0, 16);
const fromUtcInput = (value) => Math.floor(new Date(`${value}:00Z`).getTime() / 1000);
const field = (label, input, hint) => h("div", {}, h("label", {}, label), input, hint ? h("div", { class: "muted", style: "font-size:.85rem" }, hint) : null);

// Common types by extension, for files the browser reports without a type.
const MIME = { svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", mp4: "video/mp4", webm: "video/webm", html: "text/html", glb: "model/gltf-binary" };

/**
 * URI input with a button that loads a local file as a data: URI (stored on-chain, about 1,000 gas per byte), and
 * the size of the value when it is a data: URI.
 */
function uriInput(input) {
  const picker = h("input", { type: "file", hidden: true });
  const button = h("button", { type: "button", class: "secondary small" }, "Load a file as data: URI");
  const size = h("span", { class: "muted", style: "font-size:.85rem" });
  const showSize = () => {
    const v = input.value.trim();
    size.textContent = v.startsWith("data:") ? `${(v.length / 1000).toFixed(1)} KB on-chain, about ${(v.length / 1000).toFixed(1)} M gas` : "";
  };
  button.addEventListener("click", () => picker.click());
  picker.addEventListener("change", () => {
    const file = picker.files[0];
    if (!file) return;
    picker.value = "";
    if (file.type === "text/plain" || /\.txt$/i.test(file.name)) return loadText(file);
    const reader = new FileReader();
    reader.onload = () => {
      const type = file.type || MIME[file.name.split(".").pop().toLowerCase()] || "application/octet-stream";
      input.value = String(reader.result).replace(/^data:[^;,]*/, `data:${type}`);
      input.dispatchEvent(new Event("input"));
      notify(`${file.name} loaded (${(input.value.length / 1000).toFixed(1)} KB).`, "success");
    };
    reader.onerror = () => notify(`Cannot read ${file.name}.`, "error");
    reader.readAsDataURL(file);
  });
  // A text file holding a URI (e.g. a data: URI prepared elsewhere) is used as is, not encoded a second time.
  const loadText = async (file) => {
    const text = (await file.text()).trim();
    if (!/^(data|ipfs|ar|https?):/.test(text)) return notify(`${file.name} does not contain a URI: load the artwork file itself.`, "error");
    input.value = text;
    input.dispatchEvent(new Event("input"));
    notify(`URI read from ${file.name} (${(text.length / 1000).toFixed(1)} KB).`, "success");
  };
  input.addEventListener("input", showSize);
  showSize();
  return h("div", {}, input, h("div", { class: "row", style: "margin-top:6px" }, button, size, picker));
}

function requireAddress(value, name, allowZero = false) {
  const v = value.trim();
  if (!isAddress(v)) throw [`${name}: not a valid address.`];
  if (!allowZero && /^0x0{40}$/i.test(v)) throw [`${name}: the zero address is not allowed here.`];
  return getAddress(v);
}

/**
 * Buttons for one contract call. `args()` returns the arguments, or throws a list of problems to display.
 * `confirm` asks for a confirmation text before sending.
 */
function actionButtons({ fn, args, label = "Send transaction", danger = false, confirm, adminOnly = true, enabled = true, disabledReason }) {
  const out = h("div", {});
  const run = (mode) => async () => {
    let values;
    try {
      values = args();
    } catch (problems) {
      const list = Array.isArray(problems) ? problems : [errorMessage(problems)];
      return render(out, h("ul", { class: "problems" }, list.map((p) => h("li", {}, p))));
    }
    if (mode === "calldata") {
      const encoded = calldata(fn, values);
      return render(
        out,
        h("div", { class: "calldata" }, `To: ${contractAddress}\nValue: 0\nData: ${encoded}`),
        h("button", { type: "button", class: "secondary", style: "margin-top:8px", onclick: () => navigator.clipboard.writeText(encoded).then(() => notify("Calldata copied.")) }, "Copy data"),
      );
    }
    if (confirm && prompt(`Type ${confirm} to confirm.`) !== confirm) return notify("Cancelled.");
    try {
      render(out, h("p", { class: "muted" }, "Waiting for the wallet…"));
      await write(fn, values, { onSent: (hash) => render(out, h("p", { class: "muted" }, `Sent ${hash.slice(0, 10)}…, waiting for confirmation.`)) });
      render(out, h("p", { class: "status active" }, "Done."));
      notify(`${fn}: confirmed.`, "success");
      load();
    } catch (err) {
      render(out, h("ul", { class: "problems" }, h("li", {}, errorMessage(err))));
    }
  };
  const canSend = enabled && (!adminOnly || data?.isAdmin);
  const reason = !enabled ? disabledReason : "The connected wallet is not an administrator";
  return h(
    "div",
    {},
    h(
      "div",
      { class: "actions" },
      h("button", { type: "button", class: danger ? "danger" : null, onclick: run("send"), disabled: canSend ? null : true, title: canSend ? null : reason }, label),
      h("button", { type: "button", class: "secondary", onclick: run("calldata") }, "Calldata for a multisig"),
    ),
    out,
  );
}

const section = (title, open, ...body) => h("details", { class: "card", open: open ? true : null, style: "margin-top:12px" }, h("summary", {}, title), h("div", { class: "body" }, body));

// --- Sections ----------------------------------------------------------------------------------------------

function overviewSection() {
  const o = data.overview;
  const a = account().address;
  const role = !a
    ? "Connect a wallet to send transactions. Without one, you can still prepare calldata for a multisig."
    : data.isAdmin
      ? "The connected wallet is an administrator."
      : data.isProposed
        ? "The connected wallet has been proposed as an administrator."
        : "The connected wallet is not an administrator: sending is disabled, calldata stays available for a multisig.";
  const link = (addr) => (addr && !/^0x0{40}$/i.test(addr) ? h("a", { href: addressUrl(addr), target: "_blank", rel: "noopener" }, shortAddress(addr)) : h("span", { class: "muted" }, "none"));
  return h(
    "div",
    {},
    h("div", { class: data.isAdmin ? "notice ok" : "notice" }, role,
      data.isProposed ? h("div", { class: "actions" }, actionButtons({ fn: "acceptAdmin", args: () => [], label: "Accept the nomination", adminOnly: false })) : null),
    o.isShutDown ? h("div", { class: "notice warn" }, "The contract has been shut down: claims and scheduling are stopped for good.") : null,
    h(
      "div",
      { class: "card" },
      h(
        "table",
        { class: "kv" },
        h("tbody", {},
          h("tr", {}, h("th", {}, "Contract"), h("td", {}, link(contractAddress), ` on ${chain.name}`)),
          h("tr", {}, h("th", {}, "Collection"), h("td", {}, `${o.name} · ${o.monthCount} months · ${o.totalMinted} tokens`)),
          h("tr", {}, h("th", {}, "Administrators"), h("td", {}, data.admins.map((x) => h("div", {}, link(x))))),
          h("tr", {}, h("th", {}, "owner() for marketplaces"), h("td", {}, link(o.owner))),
          h("tr", {}, h("th", {}, "Team proofs to"), h("td", {}, link(o.teamRecipient))),
          h("tr", {}, h("th", {}, "Collection logo"), h("td", {}, o.collectionImage ? h("a", { href: resolveUri(o.collectionImage), target: "_blank", rel: "noopener" }, displayUri(o.collectionImage)) : h("span", { class: "muted" }, "none"))),
          h("tr", {}, h("th", {}, "Website"), h("td", {}, o.siteUrl || h("span", { class: "muted" }, "none"))),
        ),
      ),
    ),
  );
}

function monthsSection(scheduleForm) {
  const rows = data.months.map((m) => {
    const proofs = m.proofs;
    const actions = [];
    if (m.status === "upcoming") actions.push(h("button", { type: "button", class: "secondary", onclick: () => scheduleForm.edit(m) }, "Edit"));
    if (m.status === "active") {
      if (!proofs[0] && !/^0x0{40}$/i.test(m.content.artistAddress)) actions.push(actionButtons({ fn: "claimReserved", args: () => [BigInt(m.month), Edition.ArtistProof], label: "Mint artist proof", adminOnly: false }));
      if (!proofs[1] && !/^0x0{40}$/i.test(data.overview.teamRecipient)) actions.push(actionButtons({ fn: "claimReserved", args: () => [BigInt(m.month), Edition.TeamProof], label: "Mint team proof", adminOnly: false }));
    }
    if (m.status === "closed") actions.push(actionButtons({ fn: "announceMonthTotal", args: () => [BigInt(m.month)], label: "Announce total", adminOnly: false }));
    return h(
      "tr",
      {},
      h("td", { "data-label": "#" }, String(m.month)),
      h("td", { "data-label": "edition" }, h("strong", {}, m.content.label), h("div", { class: "muted" }, m.content.artist || "-")),
      h("td", { "data-label": "status" }, h("span", { class: `status ${m.status}` }, m.status)),
      h("td", { "data-label": "dates" }, formatDate(m.start), h("div", { class: "muted" }, `→ ${formatDate(m.end)}`)),
      h("td", { "data-label": "minted" }, String(m.minted), h("div", { class: "muted" }, `proofs: ${proofs[0] ? "artist ✓" : "artist –"} ${proofs[1] ? "team ✓" : "team –"}`)),
      actions.length ? h("td", { "data-label": "actions" }, actions) : h("td", {}),
    );
  });
  return section(
    "Months",
    true,
    h("p", { class: "muted" }, "Proofs and total announcements can be triggered by anyone; the token always goes to the designated address."),
    h("div", { class: "table-wrap" }, h("table", { class: "stack" }, h("thead", {}, h("tr", {}, ["#", "Edition", "Status", "Dates", "Minted", "Actions"].map((x) => h("th", {}, x)))), h("tbody", {}, rows))),
  );
}

function scheduleSection() {
  const months = data.months;
  const now = data.now;
  const last = months[months.length - 1];
  const nextHour = Math.ceil((now + 3600) / 3600) * 3600;
  const defaultStart = last && Number(last.end) > now ? Number(last.end) : nextHour;

  const inputs = {
    month: h("input", { type: "number", min: 1, value: months.length + 1 }),
    start: h("input", { type: "datetime-local", value: toUtcInput(defaultStart) }),
    end: h("input", { type: "datetime-local", value: toUtcInput(defaultStart + 30 * DAY) }),
    label: h("input", { value: monthLabel(defaultStart), placeholder: "November 2026" }),
    artist: h("input", { placeholder: "Artist name" }),
    artistAddress: h("input", { value: "0x0000000000000000000000000000000000000000", spellcheck: "false" }),
    image: h("input", { placeholder: "ipfs://… (artwork)", spellcheck: "false" }),
    animationUrl: h("input", { placeholder: "optional: ipfs://… video, 3D or HTML", spellcheck: "false" }),
  };
  const preview = h("div", {});
  const problemsBox = h("div", {});

  const values = () => ({
    month: Number(inputs.month.value),
    start: fromUtcInput(inputs.start.value),
    end: fromUtcInput(inputs.end.value),
    content: {
      label: inputs.label.value.trim(),
      artist: inputs.artist.value.trim(),
      artistAddress: inputs.artistAddress.value.trim(),
      image: inputs.image.value.trim(),
      animationUrl: inputs.animationUrl.value.trim(),
    },
  });

  const refresh = () => {
    const v = values();
    const problems = validateSchedule(v, months, data.now);
    render(problemsBox, problems.length ? h("ul", { class: "problems" }, problems.map((p) => h("li", {}, p))) : h("p", { class: "status active" }, `Valid: ${((v.end - v.start) / DAY).toFixed(2)} days.`));
    render(preview, v.content.image ? h("img", { class: "artwork", style: "max-width:220px", src: resolveUri(v.content.image), alt: "preview" }) : null);
  };
  Object.values(inputs).forEach((el) => el.addEventListener("input", refresh));
  inputs.start.addEventListener("change", () => {
    const start = fromUtcInput(inputs.start.value);
    inputs.end.value = toUtcInput(start + 30 * DAY);
    if (!inputs.label.dataset.touched) inputs.label.value = monthLabel(start);
    refresh();
  });
  inputs.label.addEventListener("input", () => (inputs.label.dataset.touched = "1"));

  const edit = (m) => {
    inputs.month.value = m.month;
    inputs.start.value = toUtcInput(m.start);
    inputs.end.value = toUtcInput(m.end);
    for (const k of ["label", "artist", "artistAddress", "image", "animationUrl"]) {
      inputs[k].value = m.content[k];
      inputs[k].dispatchEvent(new Event("input"));
    }
    inputs.label.dataset.touched = "1";
    refresh();
    node.open = true;
    node.scrollIntoView({ behavior: "smooth" });
  };

  const node = section(
    "Schedule or edit a month",
    false,
    h("p", { class: "muted" }, "Times are in UTC. A month lasts 25 to 35 days, starts in the future, never overlaps its neighbours and is locked once it starts. Check the image (square, right CID) before sending: it cannot be changed afterwards."),
    h("div", { class: "grid2" },
      field("Month number", inputs.month, `${months.length + 1} for a new month; an existing number edits a month that has not started.`),
      field("Label (English)", inputs.label),
      field("Start (UTC)", inputs.start, "Contiguous months: start = end of the previous month."),
      field("End (UTC)", inputs.end),
      field("Artist name", inputs.artist),
      field("Artist address (receives the artist proof)", inputs.artistAddress, "0x0…0 if the artist does not want one."),
      field("Image URI", uriInput(inputs.image)),
      field("Animation URI", uriInput(inputs.animationUrl)),
    ),
    preview,
    problemsBox,
    actionButtons({
      fn: "scheduleMonth",
      label: "Schedule month",
      args: () => {
        const v = values();
        const problems = validateSchedule(v, months, data.now + Math.floor((Date.now() - loadedAt) / 1000));
        if (problems.length) throw problems;
        return [BigInt(v.month), BigInt(v.start), BigInt(v.end), { ...v.content, artistAddress: getAddress(v.content.artistAddress) }];
      },
    }),
  );
  node.edit = edit;
  refresh();
  return node;
}

function collectionSection() {
  const o = data.overview;
  const image = h("input", { value: o.collectionImage, placeholder: "ipfs://… collection logo", spellcheck: "false" });
  const site = h("input", { value: o.siteUrl, placeholder: "https://… (no trailing slash)", spellcheck: "false" });
  const owner = h("input", { value: o.owner, spellcheck: "false" });
  const team = h("input", { value: o.teamRecipient, spellcheck: "false" });
  return section(
    "Collection",
    false,
    h("h3", {}, "Logo and website"),
    h("p", { class: "muted" }, "The website also gives every token its link: <website>/token/<id>. Changing it refreshes all tokens on marketplaces."),
    h("div", { class: "grid2" }, field("Logo URI", uriInput(image)), field("Website", site)),
    actionButtons({
      fn: "setCollectionInfo",
      args: () => {
        const v = [image.value.trim(), site.value.trim().replace(/\/+$/, "")];
        if (!v.every(isJsonSafe)) throw ["Double quotes, backslashes and control characters are not allowed."];
        return v;
      },
    }),
    h("h3", { class: "sep" }, "owner() for marketplaces"),
    h("p", { class: "muted" }, "Marketplaces let this address manage the collection page. It grants no right in the contract."),
    field("Address", owner),
    actionButtons({ fn: "setOwner", args: () => [requireAddress(owner.value, "owner", true)] }),
    h("h3", { class: "sep" }, "Team proofs"),
    h("p", { class: "muted" }, "Receives the team proof of the months whose proof has not been minted yet. Zero address: no team proof."),
    field("Address", team),
    actionButtons({ fn: "setTeamRecipient", args: () => [requireAddress(team.value, "team recipient", true)] }),
  );
}

function adminsSection() {
  const proposeInput = h("input", { placeholder: "0x… address to propose", spellcheck: "false" });
  const checkInput = h("input", { placeholder: "0x… address", spellcheck: "false" });
  const checkOut = h("p", { class: "muted" });
  const revokeSelect = h("select", {}, data.admins.map((a) => h("option", { value: a }, a)));
  const self = account().address;
  const acceptStatus = !self
    ? "Connect the wallet of the proposed address to accept."
    : data.isAdmin
      ? `${shortAddress(self)} is already an administrator.`
      : data.isProposed
        ? `${shortAddress(self)} has been proposed: accept to become an administrator.`
        : `${shortAddress(self)} has no pending nomination. Ask an administrator to propose it first.`;
  return section(
    "Administrators",
    data.isProposed,
    h("p", { class: "muted" }, "Adding an administrator takes two steps: an administrator proposes the address, then that address accepts from its own wallet. Accepting proves the address is controlled on this network."),
    h("h3", {}, "Accept a nomination"),
    h("p", { class: data.isProposed ? "status active" : "muted" }, acceptStatus),
    h("p", { class: "muted" }, "For a multisig (e.g. Safe), use the calldata: create a transaction from the multisig to the contract with this data."),
    actionButtons({
      fn: "acceptAdmin",
      args: () => [],
      label: "Accept my nomination",
      adminOnly: false,
      enabled: Boolean(data.isProposed),
      disabledReason: "The connected wallet has no pending nomination",
    }),
    h("h3", { class: "sep" }, "Propose"),
    field("Address", proposeInput),
    actionButtons({ fn: "proposeAdmin", args: () => [requireAddress(proposeInput.value, "address")] }),
    actionButtons({ fn: "cancelAdminProposal", label: "Cancel this proposal", args: () => [requireAddress(proposeInput.value, "address")] }),
    h("h3", { class: "sep" }, "Check a proposal"),
    h("form", { class: "row", onsubmit: async (e) => {
      e.preventDefault();
      try {
        const addr = requireAddress(checkInput.value, "address");
        const [proposed, admin] = await Promise.all([read("isProposedAdmin", [addr]), read("hasRole", [ADMIN_ROLE, addr])]);
        checkOut.textContent = admin ? "Administrator." : proposed ? "Proposed, waiting for acceptance." : "Neither administrator nor proposed.";
      } catch (problems) {
        checkOut.textContent = Array.isArray(problems) ? problems.join(" ") : errorMessage(problems);
      }
    } }, h("div", { style: "flex:1 1 320px" }, checkInput), h("button", { type: "submit", class: "secondary" }, "Check")),
    checkOut,
    h("h3", { class: "sep" }, "Remove"),
    h("p", { class: "muted" }, "The last administrator cannot be removed."),
    field("Administrator", revokeSelect),
    actionButtons({ fn: "revokeRole", label: "Revoke", danger: true, args: () => [ADMIN_ROLE, revokeSelect.value] }),
    self && data.isAdmin
      ? h("div", {}, h("p", { class: "muted", style: "margin-top:12px" }, `Leave the administrators yourself (${shortAddress(self)}):`),
        actionButtons({ fn: "renounceRole", label: "Renounce my role", danger: true, args: () => [ADMIN_ROLE, self] }))
      : null,
  );
}

function rescueSection() {
  const nativeTo = h("input", { placeholder: "0x… destination", spellcheck: "false" });
  const nativeAmount = h("input", { placeholder: "amount in POL, e.g. 1.5" });
  const erc20Token = h("input", { placeholder: "0x… token contract", spellcheck: "false" });
  const erc20To = h("input", { placeholder: "0x… destination", spellcheck: "false" });
  const erc20Amount = h("input", { placeholder: "raw amount (smallest unit, e.g. 1000000 = 1 USDC)" });
  const nftToken = h("input", { placeholder: "0x… NFT contract", spellcheck: "false" });
  const nftId = h("input", { placeholder: "token id" });
  const nftTo = h("input", { placeholder: "0x… destination", spellcheck: "false" });
  const bigint = (v, name) => { try { return BigInt(v.trim()); } catch { throw [`${name}: not a whole number.`]; } };
  return section(
    "Recover assets sent by mistake",
    false,
    h("p", { class: "muted" }, "Only for assets sent to the contract by mistake. Tokens of this collection can never be moved."),
    h("h3", {}, "POL (forced transfers only)"),
    h("div", { class: "grid2" }, field("Destination", nativeTo), field("Amount", nativeAmount)),
    actionButtons({ fn: "rescueNative", args: () => {
      const to = requireAddress(nativeTo.value, "destination");
      try { return [to, parseEther(nativeAmount.value.trim())]; } catch { throw ["Amount: not a valid number."]; }
    } }),
    h("h3", { class: "sep" }, "ERC-20 tokens"),
    h("div", { class: "grid2" }, field("Token", erc20Token), field("Destination", erc20To), field("Amount", erc20Amount)),
    actionButtons({ fn: "rescueERC20", args: () => [requireAddress(erc20Token.value, "token"), requireAddress(erc20To.value, "destination"), bigint(erc20Amount.value, "amount")] }),
    h("h3", { class: "sep" }, "NFTs of other collections"),
    h("div", { class: "grid2" }, field("Collection", nftToken), field("Token id", nftId), field("Destination", nftTo)),
    actionButtons({ fn: "rescueERC721", args: () => [requireAddress(nftToken.value, "collection"), bigint(nftId.value, "token id"), requireAddress(nftTo.value, "destination")] }),
  );
}

function shutdownSection() {
  return section(
    "Emergency shutdown",
    false,
    h("div", { class: "notice warn" }, "Irreversible. Claims, proofs and scheduling stop for good; the running month is closed. Transfers, metadata and asset recovery keep working. Use it if a flaw is found or an administrator key is compromised."),
    actionButtons({ fn: "shutdown", label: "Shut the contract down", danger: true, confirm: "SHUTDOWN", args: () => [] }),
  );
}

// --- Page --------------------------------------------------------------------------------------------------

async function load(retry = true) {
  try {
    const [overview, months, admins, now] = await Promise.all([getOverview(), getAllMonths(), getAdmins(), chainNow()]);
    const proofs = await Promise.all(months.map((m) => read("proofsMinted", [BigInt(m.month)])));
    months.forEach((m, i) => (m.proofs = proofs[i]));
    const a = account().address;
    const [isAdmin, isProposed] = a ? await Promise.all([read("hasRole", [ADMIN_ROLE, a]), read("isProposedAdmin", [a])]) : [false, false];
    data = { overview, months, admins, isAdmin, isProposed, now: Number(now) };
    loadedAt = Date.now();
  } catch (err) {
    // Right after a transaction, a lagging RPC node can serve an older state for a few seconds: read again once.
    if (retry) return new Promise((r) => setTimeout(r, 4000)).then(() => load(false));
    render(app, h("h1", {}, "Administration"), h("div", { class: "notice warn" }, `Cannot read the contract: ${errorMessage(err)}`));
    return;
  }
  const schedule = scheduleSection();
  render(
    app,
    h("div", { class: "kicker", style: "margin-top:0" }, "// restricted"),
    h("h1", {}, "Administration"),
    overviewSection(),
    monthsSection(schedule),
    schedule,
    collectionSection(),
    adminsSection(),
    rescueSection(),
    shutdownSection(),
  );
}

onAccountChange(() => load());
load();
