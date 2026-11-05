// Mining page: a few questions pick the right path, then mine a proof in the browser and claim the token, from the
// connected wallet or through the relay.
import { encodeAbiParameters, getAddress, isAddress, keccak256 } from "viem";
import { MINING_MARGIN_CLAIMS, chainId, contractAddress, relayUrl } from "../lib/config.js";
import { aimTarget, expectedHashes, findMintEvent, getMonth, leadingZeroBits, publicClient, read } from "../lib/contract.js";
import { formatNumber, lang, t, tn } from "../lib/i18n.js";
import { h, initLayout, notify, render } from "../lib/layout.js";
import { Miner } from "../lib/miner.js";
import { submitClaim, waitForClaim } from "../lib/relay.js";
import { createCountdown, errorMessage, errorName, formatDate, formatDuration, formatHashes, resolveUri, shortAddress, txUrl } from "../lib/util.js";
import { hasConsent, setConsent } from "../lib/consent.js";
import { account, connect, isEmailAccount, onAccountChange, openAccount, walletServicesExist, write } from "../lib/wallet.js";

initLayout("mine");
const app = document.getElementById("app");

// Route: "wallet" sends the claim from the visitor's wallet, "relay" lets the relay send it for any address, "account"
// does the same for the address of an email account.
const ROUTES = ["wallet", "relay", "account"];
const ROUTE_KEY = "artpow-mine-route";
const savedRoute = () => { try { return localStorage.getItem(ROUTE_KEY); } catch { return null; } };
const firstRoute = () => {
  if (!relayUrl) return "wallet";
  const saved = savedRoute();
  return ROUTES.includes(saved) && (saved !== "account" || walletServicesExist()) ? saved : null;
};

const state = { month: null, seed: null, target: 0n, recipient: "", proof: null, miner: null, poll: null, route: firstRoute(), question: walletServicesExist() ? "address" : "pol", formDone: false };
const usesRelay = () => state.route === "relay" || state.route === "account";

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

const monthBox = h("div", { style: "margin-top:24px" });
const guideBox = h("div", { class: "guide" });
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
const recipientRow = h("div", {});
const minerCard = h("div", { class: "card", style: "margin-top:24px" });

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

// --- Guide -------------------------------------------------------------------------------------------------

const choice = (title, text, onclick) =>
  h("button", { type: "button", class: "secondary choice", onclick }, h("strong", {}, title), h("span", { class: "muted" }, text));

function setRoute(route) {
  if (state.miner?.running) stopMining();
  state.route = route;
  state.proof = null;
  state.formDone = false;
  render(resultBox);
  try {
    if (route) localStorage.setItem(ROUTE_KEY, route);
    else localStorage.removeItem(ROUTE_KEY);
  } catch {}
  if (route === "account") recipientInput.value = account().address ?? "";
  renderGuide();
  if (route) checkRecipient();
}

function renderGuide() {
  const address = account().address;
  minerCard.hidden = !state.route || (state.route === "account" && !address) || state.formDone;
  recipientRow.hidden = state.route === "account";
  if (!relayUrl) return render(guideBox);
  const change = h("button", { type: "button", class: "secondary small", onclick: () => { state.question = walletServicesExist() ? "address" : "pol"; setRoute(null); } }, t("mine.guide.change"));
  const card = (...content) => h("div", { class: "card" }, ...content);

  // A connected visitor has an address: the first question has no point.
  if (!state.route && state.question === "address" && !address) {
    return render(guideBox, card(
      h("h3", {}, t("mine.guide.address")),
      h("div", { class: "choices" },
        choice(t("mine.guide.hasAddress"), t("mine.guide.hasAddressText"), () => { state.question = "pol"; renderGuide(); }),
        choice(t("mine.guide.noAddress"), t("mine.guide.noAddressText"), () => setRoute("account"))),
    ));
  }
  if (!state.route) {
    return render(guideBox, card(
      h("h3", {}, t("mine.guide.pol")),
      h("div", { class: "choices" },
        choice(t("mine.guide.relayGas"), t("mine.guide.relayGasText"), () => setRoute("relay")),
        choice(t("mine.guide.ownGas"), t("mine.guide.ownGasText"), () => setRoute("wallet"))),
      walletServicesExist() && !address ? h("div", { class: "row", style: "margin-top:12px" }, change) : null,
    ));
  }
  if (state.route === "account" && !address) {
    return render(guideBox, card(
      h("h3", {}, t("mine.guide.login")),
      h("p", {}, t("mine.guide.loginText")),
      h("p", { class: "muted" }, t("mine.guide.loginPrivacy")),
      h("div", { class: "row" },
        hasConsent()
          ? h("button", { type: "button", onclick: () => connect().catch((err) => notify(errorMessage(err), "error")) }, t("mine.guide.loginButton"))
          : h("button", { type: "button", onclick: () => setConsent("yes", { openWallet: true }) }, t("mine.guide.loginConsent")),
        change),
    ));
  }
  return render(guideBox, h("div", { class: "row guide-summary" },
    h("span", { class: "muted" }, state.route === "wallet" ? t("mine.guide.routeWallet") : state.route === "relay" ? t("mine.guide.routeRelay") : t("mine.guide.routeAccount", { address: shortAddress(address) })),
    state.route === "account" ? h("button", { type: "button", class: "secondary small", onclick: openAccount }, t("mine.guide.manage")) : null,
    isEmailAccount() ? null : change,
  ));
}

// --- Recipient ---------------------------------------------------------------------------------------------

/** Checks the recipient field; returns the problem (shown under the field) or null when mining can start. */
async function checkRecipient({ offerSaved = true } = {}) {
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
  const isContract = code && code !== "0x";
  if (isContract && usesRelay()) {
    state.recipient = "";
    return problem(t("mine.recipient.contractRelay"));
  }
  const notes = [usesRelay() ? t("mine.recipient.okRelay") : t("mine.recipient.ok")];
  if (isContract) notes.push(t("mine.recipient.contract"));
  render(recipientNote, notes.join(" "));
  if (offerSaved) await offerSavedProof();
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
  const problem = await checkRecipient({ offerSaved: false });
  if (problem) return notify(problem, "error");
  state.proof = null;
  const aim = aimTarget(state.target, MINING_MARGIN_CLAIMS);
  render(resultBox);
  countdown = createCountdown();
  shownAt = -Infinity;
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

let proofStatus;
let claimButton;
let countdown = createCountdown();
let shownAt = -Infinity;

function onProgress({ hashrate, tried, expected }) {
  // Every worker reports on its own, several times a second: the figures only need to change once a second.
  const now = performance.now() / 1000;
  if (now - shownAt < 1) return;
  shownAt = now;
  const p = 1 - Math.exp(-tried / expected);
  const remaining = countdown(Math.max(0, expected - tried) / Math.max(hashrate, 1), now);
  render(progressBar, h("div", { class: "progress" }, h("div", { style: `width:${(p * 100).toFixed(1)}%` })));
  progressText.hidden = false;
  progressValues.rate.textContent = `${formatHashes(hashrate)}H/s`;
  progressValues.tried.textContent = formatHashes(tried);
  progressValues.chance.textContent = p.toLocaleString(lang, { style: "percent" });
  // The search is random: past the average it can end at any moment, and "0 s" would look stuck.
  progressValues.left.textContent = remaining > 0 ? formatDuration(remaining) : t("mine.progress.soon");
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
  // Through the relay there is nothing to sign or decide, and every claim that gets in first makes the proof weaker.
  if (usesRelay()) return claimThroughRelay();
  showProof(t("mine.found"));
}

function showForm() {
  state.formDone = false;
  renderGuide();
}

function hideForm() {
  state.formDone = true;
  renderGuide();
}

function showProof(title) {
  const p = state.proof;
  const label = usesRelay() ? t("mine.relayClaim") : account().address ? t("mine.claim") : t("mine.connectClaim");
  proofStatus = h("p", { class: "muted", hidden: true });
  claimButton = h("button", { type: "button", onclick: claim }, label);
  hideForm();
  render(
    resultBox,
    h(
      "div",
      { class: "notice ok" },
      h("h3", {}, title),
      h("p", {}, t("mine.zeroBits", { bits: leadingZeroBits(p.hash) })),
      h("p", { class: "muted" }, t("mine.submitSoon")),
      proofStatus,
      h("div", { class: "row" },
        claimButton,
        h("button", { type: "button", class: "secondary", onclick: () => { state.proof = null; render(resultBox); showForm(); } }, t("mine.backToForm"))),
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

const showProofStatus = (text) => {
  proofStatus.hidden = !text;
  proofStatus.textContent = text;
};

function showClaimed(receipt, txHash) {
  const ev = receipt && findMintEvent(receipt);
  const id = ev ? Number(ev.args.tokenId) : null;
  render(
    resultBox,
    h(
      "div",
      { class: "notice ok" },
      // The NFT's name carries its edition number; the token id also counts the artist and team proofs.
      h("h3", {}, ev ? t("mine.claimedTitle", { name: `${state.month.content.label} • #${ev.args.number}` }) : t("mine.claimedShort")),
      id ? h("p", { class: "muted" }, t("mine.tokenId", { id })) : null,
      usesRelay() ? h("p", { class: "muted" }, t("mine.relayAfter")) : null,
      h("div", { class: "row" },
        id ? h("a", { class: "button", href: `gallery#token=${id}` }, t("mine.seeGallery")) : null,
        txUrl(txHash) ? h("a", { class: "button secondary", href: txUrl(txHash), target: "_blank", rel: "noopener" }, t("mine.transaction")) : null,
      ),
    ),
  );
  state.proof = null;
  loadMonth();
}

async function claimThroughRelay() {
  const p = state.proof;
  const status = h("p", { class: "muted" }, t("mine.relaySending"));
  render(resultBox, h("div", { class: "notice ok" }, h("h3", {}, t("mine.relayFound")), status));
  // The message takes the form's place: nothing more to mine unless the relay fails. "Change" brings the form back.
  hideForm();
  try {
    const { id } = await submitClaim(relayUrl, p);
    const txHash = await waitForClaim(relayUrl, id, { onSent: () => { status.textContent = t("mine.relaySent"); } });
    forgetProof(p.month, p.recipient);
    // The token is minted whatever happens here: a lagging public node only costs the edition number on screen.
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 }).catch(() => null);
    showClaimed(receipt, txHash);
  } catch (err) {
    relayFailed(err.code ?? "relay_unavailable", p);
  }
}

function relayFailed(code, p) {
  showForm();
  if (code === "proof_outdated" || code === "insufficient_work") {
    forgetProof(p.month, p.recipient);
    state.proof = null;
    return render(resultBox, h("div", { class: "notice warn" }, t("mine.outrun")));
  }
  if (code === "already_claimed") {
    forgetProof(p.month, p.recipient);
    state.proof = null;
    return render(resultBox, h("div", { class: "notice ok" }, t("mine.receivedMeanwhile")));
  }
  if (code === "month_not_active") {
    state.proof = null;
    return render(resultBox, h("div", { class: "notice warn" }, t("mine.recipient.noMonth")));
  }
  if (code === "contract_recipient") return render(resultBox, h("div", { class: "notice warn" }, t("mine.recipient.contractRelay")));
  // Anything else is on the relay's side (no funds, gas price, outage): the proof stays valid and saved.
  console.warn("Relay failure:", code);
  render(resultBox, h("div", { class: "notice warn" },
    h("p", {}, t("mine.relayFailed")),
    h("div", { class: "row" },
      h("button", { type: "button", onclick: claimThroughRelay }, t("mine.relayRetry")),
      state.route === "relay" ? h("button", { type: "button", class: "secondary", onclick: () => setRoute("wallet") }, t("mine.relayUseWallet")) : null),
  ));
}

async function claim() {
  if (usesRelay()) return claimThroughRelay();
  const p = state.proof;
  try {
    if (!account().address) {
      await connect();
      return notify(t("mine.connectedClaimAgain"));
    }
    claimButton.disabled = true;
    showProofStatus(t("mine.walletConfirm"));
    const receipt = await write("claim", [BigInt(p.month), p.recipient, p.nonce], {
      onSent: (hash) => {
        notify(t("mine.txSent", { hash: hash.slice(0, 10) }));
        showProofStatus(t("mine.relaySent"));
      },
    });
    forgetProof(p.month, p.recipient);
    showClaimed(receipt, receipt.transactionHash);
  } catch (err) {
    const message = errorMessage(err);
    notify(message, "error");
    claimButton.disabled = false;
    showProofStatus("");
    if (errorName(err) === "InsufficientWork") {
      forgetProof(p.month, p.recipient);
      state.proof = null;
      render(resultBox, h("div", { class: "notice warn" }, t("mine.outrun")));
      showForm();
    }
  }
}

// --- Page --------------------------------------------------------------------------------------------------

startButton.addEventListener("click", () => (state.miner?.running ? stopMining() : startMining()));
recipientInput.addEventListener("change", checkRecipient);
onAccountChange((a) => {
  // An email account has no POL to send a transaction with: the relay is its only path, so nothing needs asking.
  if (isEmailAccount() && state.route !== "account") return setRoute("account");
  if (!state.route) renderGuide();
  if (state.proof && state.route === "wallet" && claimButton) claimButton.textContent = a.address ? t("mine.claim") : t("mine.connectClaim");
  if (state.route === "account") {
    // Signed in, out or as someone else: the proof and the field follow the account.
    if (state.miner?.running) stopMining();
    state.proof = null;
    state.formDone = false;
    render(resultBox);
    recipientInput.value = a.address ?? "";
    renderGuide();
    if (a.address) checkRecipient();
    return;
  }
  if (a.address && !recipientInput.value) {
    recipientInput.value = a.address;
    checkRecipient();
  }
});

render(
  recipientRow,
  h("label", {}, t("mine.recipient")),
  h("div", { class: "row" }, h("div", { style: "flex:1 1 320px" }, recipientInput),
    h("button", { type: "button", class: "secondary", onclick: async () => {
      if (!account().address) return connect();
      recipientInput.value = account().address;
      checkRecipient();
    } }, t("mine.useWallet"))),
);
render(
  minerCard,
  h("h3", {}, t("mine.miner")),
  recipientRow,
  recipientNote,
  h("div", { class: "row", style: "margin-top:8px" }, threadsSelect, startButton),
  progressBar,
  progressText,
  closesSoon,
);
render(
  app,
  h("div", { class: "kicker", style: "margin-top:0" }, t("mine.kicker")),
  h("h1", {}, t("mine.title")),
  h("p", { class: "lead" }, t("mine.lead")),
  // What to do comes first: nobody should have to scroll past the artwork to find where to start.
  guideBox,
  minerCard,
  resultBox,
  monthBox,
);
if (isEmailAccount()) setRoute("account");
else renderGuide();

(async () => {
  try {
    await loadMonth();
    if (account().address) recipientInput.value = account().address;
    if (state.route) await checkRecipient();
  } catch (err) {
    render(monthBox, h("div", { class: "notice warn" }, t("common.cannotRead", { error: errorMessage(err) })));
  }
})();
