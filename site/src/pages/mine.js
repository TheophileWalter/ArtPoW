// Mining page: mine a proof in the browser, then claim the token from the connected wallet.
import { encodeAbiParameters, getAddress, isAddress, keccak256 } from "viem";
import { MINING_MARGIN_CLAIMS, chainId, contractAddress } from "../lib/config.js";
import { aimTarget, expectedHashes, findMintEvent, getMonth, leadingZeroBits, publicClient, read } from "../lib/contract.js";
import { formatNumber, lang, t, tn } from "../lib/i18n.js";
import { h, initLayout, notify, render } from "../lib/layout.js";
import { Miner } from "../lib/miner.js";
import { errorMessage, errorName, formatDate, formatDuration, formatHashes, resolveUri, shortAddress, txUrl } from "../lib/util.js";
import { account, connect, onAccountChange, write } from "../lib/wallet.js";

initLayout("mine.html");
const app = document.getElementById("app");

const state = { month: null, seed: null, target: 0n, recipient: "", proof: null, miner: null, poll: null };

const storageKey = (month, recipient) => `artpow-proof:${chainId}:${contractAddress}:${month}:${recipient.toLowerCase()}`;
const saveProof = (p) => { try { localStorage.setItem(storageKey(p.month, p.recipient), p.nonce.toString()); } catch {} };
const loadNonce = (month, recipient) => { try { return localStorage.getItem(storageKey(month, recipient)); } catch { return null; } };
const forgetProof = (month, recipient) => { try { localStorage.removeItem(storageKey(month, recipient)); } catch {} };

const powHash = (seed, month, recipient, nonce) =>
  BigInt(keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }],
    [seed, BigInt(month), recipient, nonce],
  )));

// --- UI elements -------------------------------------------------------------------------------------------

const monthBox = h("div", {});
const recipientInput = h("input", { placeholder: t("mine.recipientPlaceholder"), spellcheck: "false" });
const recipientNote = h("p", { class: "muted" });
const threadsSelect = h("select", { style: "max-width:120px" });
const startButton = h("button", { type: "button" }, t("mine.start"));
const progressBar = h("div", {});
// Fixed tiles, updated in place: the values change several times a second, a sentence would keep shifting.
const progressValues = { rate: h("div", { class: "value" }), tried: h("div", { class: "value" }), chance: h("div", { class: "value" }), left: h("div", { class: "value" }) };
const progressText = h(
  "div",
  { class: "stats stats-4", hidden: true, style: "margin-bottom:10px" },
  Object.entries(progressValues).map(([key, value]) => h("div", { class: "stat" }, value, h("div", { class: "label" }, t(`mine.progress.${key}`)))),
);
const closesSoon = h("p", { class: "muted", hidden: true }, t("mine.closesSoon"));
const resultBox = h("div", {});

for (let i = 1; i <= Math.max(1, navigator.hardwareConcurrency || 4); i++) {
  threadsSelect.append(h("option", { value: i, selected: i === Miner.defaultThreads() ? true : null }, tn("mine.threads", i)));
}

// --- Month -------------------------------------------------------------------------------------------------

async function loadMonth() {
  const active = Number(await read("activeMonth"));
  if (!active) {
    const count = Number(await read("monthCount"));
    let next = null;
    for (let m = count; m >= 1; m--) {
      const info = await getMonth(m);
      if (info.status === "upcoming") next = info;
      else break;
    }
    render(monthBox, h("div", { class: "notice" }, next ? t("mine.noneOpenNext", { label: next.content.label, date: formatDate(next.start) }) : t("mine.noneOpen")));
    startButton.disabled = true;
    return;
  }
  const [info, seed, target] = await Promise.all([getMonth(active), read("monthSeed", [BigInt(active)]), read("currentTarget", [BigInt(active)])]);
  Object.assign(state, { month: info, seed, target });
  const now = Math.floor(Date.now() / 1000);
  render(
    monthBox,
    h(
      "div",
      { class: "card hero top" },
      h("div", { class: "art-frame" }, h("img", { class: "artwork", src: resolveUri(info.content.image), alt: info.content.label })),
      h(
        "div",
        {},
        h("h2", { style: "margin-top:0" }, info.content.label),
        info.content.artist ? h("p", {}, `${t("common.by")} `, h("strong", {}, info.content.artist)) : null,
        h(
          "div",
          { class: "stats" },
          h("div", { class: "stat" }, h("div", { class: "value" }, formatNumber(info.minted)), h("div", { class: "label" }, t("common.minted"))),
          h("div", { class: "stat" }, h("div", { class: "value" }, formatDuration(Number(info.end) - now)), h("div", { class: "label" }, t("common.left"))),
          h("div", { class: "stat" }, h("div", { class: "value" }, formatHashes(expectedHashes(aimTarget(target, MINING_MARGIN_CLAIMS)))), h("div", { class: "label" }, t("mine.hashesExpected"))),
        ),
        h("p", { class: "muted" }, t("mine.closes", { date: formatDate(info.end) })),
      ),
    ),
  );
  startButton.disabled = false;
}

// --- Recipient ---------------------------------------------------------------------------------------------

/** Checks the recipient field; returns the problem (shown under the field) or null when mining can start. */
async function checkRecipient() {
  const value = recipientInput.value.trim();
  state.recipient = "";
  const problem = (message) => {
    render(recipientNote, h("span", { class: "field-problem" }, message));
    return message;
  };
  if (!value) return problem(t("mine.recipient.empty"));
  if (!isAddress(value)) return problem(t("mine.recipient.invalid", { value: value.length > 20 ? `${value.slice(0, 20)}…` : value }));
  const recipient = getAddress(value);
  // Month not loaded yet (or none open): nothing to show under the field, the month box explains it.
  if (!state.month) return t("mine.recipient.noMonth");
  const [claimed, code] = await Promise.all([
    read("hasClaimed", [BigInt(state.month.month), recipient]),
    publicClient.getCode({ address: recipient }),
  ]);
  if (claimed) {
    return problem(t("mine.recipient.claimed", { address: shortAddress(recipient), label: state.month.content.label }));
  }
  state.recipient = recipient;
  const notes = [t("mine.recipient.ok")];
  if (code && code !== "0x") notes.push(t("mine.recipient.contract"));
  render(recipientNote, notes.join(" "));
  await offerSavedProof();
  return null;
}

async function offerSavedProof() {
  const saved = loadNonce(state.month.month, state.recipient);
  if (!saved) return;
  const nonce = BigInt(saved);
  const hash = powHash(state.seed, state.month.month, state.recipient, nonce);
  const target = await read("currentTarget", [BigInt(state.month.month)]);
  if (hash < target) {
    state.proof = { month: state.month.month, recipient: state.recipient, nonce, hash };
    showProof(t("mine.savedValid"));
  } else {
    forgetProof(state.month.month, state.recipient);
  }
}

// --- Mining ------------------------------------------------------------------------------------------------

async function startMining() {
  // Checked again on start: the field may have changed without losing focus, or the address claimed meanwhile.
  const problem = await checkRecipient();
  if (problem) return notify(problem, "error");
  const aim = aimTarget(state.target, MINING_MARGIN_CLAIMS);
  render(resultBox);
  state.miner = new Miner({ onProgress, onFound });
  state.miner.start({ seed: state.seed, month: state.month.month, recipient: state.recipient, target: aim, threads: Number(threadsSelect.value) });
  startButton.textContent = t("mine.stop");
  recipientInput.disabled = true;
  threadsSelect.disabled = true;
  state.poll = setInterval(refreshTarget, 15_000);
}

function stopMining() {
  state.miner?.stop();
  clearInterval(state.poll);
  startButton.textContent = t("mine.start");
  recipientInput.disabled = false;
  threadsSelect.disabled = false;
}

function onProgress({ hashrate, tried, expected }) {
  const p = 1 - Math.exp(-tried / expected);
  const remaining = Math.max(0, expected - tried) / Math.max(hashrate, 1);
  render(progressBar, h("div", { class: "progress" }, h("div", { style: `width:${(p * 100).toFixed(1)}%` })));
  progressText.hidden = false;
  progressValues.rate.textContent = `${formatHashes(hashrate)}H/s`;
  progressValues.tried.textContent = formatHashes(tried);
  progressValues.chance.textContent = p.toLocaleString(lang, { style: "percent" });
  progressValues.left.textContent = formatDuration(remaining);
  const left = Number(state.month.end) - Date.now() / 1000;
  closesSoon.hidden = left >= (expected / Math.max(hashrate, 1)) * 2;
}

async function refreshTarget() {
  try {
    const [target, claimed] = await Promise.all([
      read("currentTarget", [BigInt(state.month.month)]),
      read("hasClaimed", [BigInt(state.month.month), state.recipient]),
    ]);
    if (claimed) {
      stopMining();
      return render(resultBox, h("div", { class: "notice ok" }, t("mine.receivedMeanwhile")));
    }
    if (target !== state.target) {
      state.target = target;
      state.miner.setTarget(aimTarget(target, MINING_MARGIN_CLAIMS));
    }
  } catch (err) {
    console.warn(err);
  }
}

async function onFound({ nonce, hash }) {
  // Check against the target right now: other claims may have made it harder since mining started.
  const target = await read("currentTarget", [BigInt(state.month.month)]);
  if (hash >= target || state.proof) return;
  stopMining();
  state.proof = { month: state.month.month, recipient: state.recipient, nonce, hash };
  saveProof(state.proof);
  showProof(t("mine.found"));
}

function showProof(title) {
  const p = state.proof;
  const claimButton = h("button", { type: "button", onclick: claim }, account().address ? t("mine.claim") : t("mine.connectClaim"));
  render(
    resultBox,
    h(
      "div",
      { class: "card" },
      h("h3", {}, title),
      h("p", {}, t("mine.zeroBits", { bits: leadingZeroBits(p.hash) })),
      h("p", { class: "muted" }, t("mine.submitSoon")),
      claimButton,
      h(
        "details",
        { style: "margin-top:12px" },
        h("summary", { class: "muted" }, t("mine.otherWay")),
        h("p", { class: "muted" }, t("mine.otherWayText")),
        h("div", { class: "calldata" }, `month: ${p.month}\nrecipient: ${p.recipient}\nnonce: ${p.nonce}`),
      ),
    ),
  );
}

async function claim() {
  const p = state.proof;
  try {
    if (!account().address) {
      await connect();
      return notify(t("mine.connectedClaimAgain"));
    }
    const receipt = await write("claim", [BigInt(p.month), p.recipient, p.nonce], {
      onSent: (hash) => notify(t("mine.txSent", { hash: hash.slice(0, 10) })),
    });
    const ev = findMintEvent(receipt);
    forgetProof(p.month, p.recipient);
    const id = ev ? Number(ev.args.tokenId) : null;
    render(
      resultBox,
      h(
        "div",
        { class: "notice ok" },
        // The NFT's name carries its edition number; the token id also counts the artist and team proofs.
        h("h3", {}, ev ? t("mine.claimedTitle", { name: `${state.month.content.label} • #${ev.args.number}` }) : t("mine.claimedShort")),
        id ? h("p", { class: "muted" }, t("mine.tokenId", { id })) : null,
        h("div", { class: "row" },
          id ? h("a", { class: "button", href: `gallery.html#token=${id}` }, t("mine.seeGallery")) : null,
          txUrl(receipt.transactionHash) ? h("a", { class: "button secondary", href: txUrl(receipt.transactionHash), target: "_blank", rel: "noopener" }, t("mine.transaction")) : null,
        ),
      ),
    );
    state.proof = null;
    loadMonth();
  } catch (err) {
    const message = errorMessage(err);
    notify(message, "error");
    if (errorName(err) === "InsufficientWork") {
      forgetProof(p.month, p.recipient);
      state.proof = null;
      render(resultBox, h("div", { class: "notice warn" }, t("mine.outrun")));
    }
  }
}

// --- Page --------------------------------------------------------------------------------------------------

startButton.addEventListener("click", () => (state.miner?.running ? stopMining() : startMining()));
recipientInput.addEventListener("change", checkRecipient);
onAccountChange((a) => {
  if (a.address && !recipientInput.value) {
    recipientInput.value = a.address;
    checkRecipient();
  }
});

render(
  app,
  h("div", { class: "kicker", style: "margin-top:0" }, t("mine.kicker")),
  h("h1", {}, t("mine.title")),
  h("p", { class: "lead" }, t("mine.lead")),
  monthBox,
  h(
    "div",
    { class: "card", style: "margin-top:24px" },
    h("h3", {}, t("mine.miner")),
    h("label", {}, t("mine.recipient")),
    h("div", { class: "row" }, h("div", { style: "flex:1 1 320px" }, recipientInput),
      h("button", { type: "button", class: "secondary", onclick: async () => {
        if (!account().address) return connect();
        recipientInput.value = account().address;
        checkRecipient();
      } }, t("mine.useWallet"))),
    recipientNote,
    h("div", { class: "row", style: "margin-top:8px" }, threadsSelect, startButton),
    progressBar,
    progressText,
    closesSoon,
  ),
  resultBox,
);

(async () => {
  try {
    await loadMonth();
    if (account().address) recipientInput.value = account().address;
    await checkRecipient();
  } catch (err) {
    render(monthBox, h("div", { class: "notice warn" }, t("common.cannotRead", { error: errorMessage(err) })));
  }
})();
