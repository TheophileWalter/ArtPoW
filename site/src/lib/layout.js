// Shared page chrome (header, navigation, wallet button, footer) and small DOM helpers.
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import { formatEther, zeroAddress } from "viem";
import { chain, chainId, contractAddress, sourceUrl } from "./config.js";
import { publicClient, read } from "./contract.js";
import { LANGUAGES, formatNumber, lang, setLanguage, t, translateDocument } from "./i18n.js";
import { addressUrl, errorMessage, shortAddress } from "./util.js";
import { account, connect, disconnect, onAccountChange } from "./wallet.js";

/** Creates an element: h("a", { href: "#", class: "x", onclick }, "text", child). */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// The administration page is deliberately left out: it is reached by its address only.
const PAGES = [
  ["index.html", "nav.home"],
  ["how.html", "nav.how"],
  ["mine.html", "nav.mine"],
  ["gallery.html", "nav.gallery"],
  ["stats.html", "nav.stats"],
  ["whitepaper.html", "nav.whitepaper"],
];
const TITLES = { "index.html": "title.home", "how.html": "title.how", "mine.html": "title.mine", "gallery.html": "title.gallery", "stats.html": "title.stats", "whitepaper.html": "title.whitepaper" };

export function initLayout(active) {
  if (TITLES[active]) document.title = t(TITLES[active]);
  translateDocument();
  const walletButton = h("button", { class: "button secondary wallet", type: "button" });
  const refreshWallet = () => {
    const a = account();
    walletButton.textContent = a.address ? shortAddress(a.address) : t("wallet.connect");
    walletButton.title = a.address ? t("wallet.details") : t("wallet.connectTitle");
  };
  walletButton.addEventListener("click", async () => {
    try {
      if (account().address) walletDialog();
      else await connect();
    } catch (err) {
      notify(errorMessage(err), "error");
    }
  });
  onAccountChange(refreshWallet);
  refreshWallet();

  const nav = h(
    "nav",
    { class: "nav", "aria-label": t("nav.main") },
    PAGES.map(([href, key]) => h("a", { href, class: href === active ? "active" : null }, t(key))),
  );
  const menuButton = h("button", { class: "menu-toggle", type: "button", "aria-label": t("nav.menu"), "aria-expanded": "false" }, "☰");
  const langSelect = h(
    "select",
    { class: "lang-select", "aria-label": t("lang.label"), title: t("lang.label") },
    Object.entries(LANGUAGES).map(([code, name]) => h("option", { value: code, selected: code === lang ? true : null }, `${code.toUpperCase()} · ${name}`)),
  );
  langSelect.addEventListener("change", () => setLanguage(langSelect.value));
  // Narrow screens show the code only ("FR"); the open list keeps the names.
  const narrow = matchMedia("(max-width: 480px)");
  const labelLanguages = () => [...langSelect.options].forEach((opt) => (opt.textContent = narrow.matches ? opt.value.toUpperCase() : `${opt.value.toUpperCase()} · ${LANGUAGES[opt.value]}`));
  narrow.addEventListener("change", labelLanguages);
  labelLanguages();
  const themeButton = h("button", { class: "theme-toggle", type: "button" });
  const showTheme = () => {
    const light = document.documentElement.dataset.theme === "light";
    themeButton.textContent = light ? "☾" : "☀";
    themeButton.setAttribute("aria-label", light ? t("theme.toDark") : t("theme.toLight"));
    themeButton.title = themeButton.getAttribute("aria-label");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", light ? "#f5f6fa" : "#07080c");
  };
  themeButton.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {
      // private mode or blocked storage: the choice lasts for this page only
    }
    showTheme();
  });
  showTheme();
  const header = h(
    "header",
    { class: "site-header" },
    h("a", { href: "index.html", class: "brand" }, h("span", { class: "logo" }, "0x"), "ArtPoW"),
    nav,
    h("div", { class: "header-right" }, h("span", { class: "badge network" }, h("span", { class: "dot" }), chain.name), langSelect, themeButton, walletButton, menuButton),
  );
  menuButton.addEventListener("click", () => {
    const open = header.classList.toggle("open");
    menuButton.setAttribute("aria-expanded", String(open));
  });

  const footer = h(
    "footer",
    { class: "site-footer" },
    h(
      "div",
      { class: "inner" },
      h("span", {}, t("footer.tagline")),
      h(
        "div",
        { class: "links" },
        h("a", { href: addressUrl(contractAddress), target: "_blank", rel: "noopener" }, t("footer.contract", { address: shortAddress(contractAddress) })),
        sourceUrl ? h("a", { href: sourceUrl, target: "_blank", rel: "noopener" }, t("footer.source")) : null,
        h("a", { href: "whitepaper.html" }, t("footer.whitepaper")),
      ),
    ),
  );
  document.body.prepend(header);
  document.body.append(footer);
  document.body.append(h("div", { id: "toasts", class: "toasts", "aria-live": "polite" }));
}

/** Connected wallet: address, network, balances and the disconnect button. */
function walletDialog() {
  const a = account();
  const value = (text = "…") => h("td", { class: "mono" }, text);
  const balance = value();
  const owned = value();
  const close = () => dialog.close();
  const copyButton = h("button", { type: "button", class: "secondary small" }, t("wallet.copy"));
  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(a.address);
      copyButton.textContent = t("wallet.copied");
    } catch {
      notify(t("wallet.copyFailed"), "error");
    }
  });
  const disconnectButton = h("button", { type: "button", class: "danger" }, t("wallet.disconnect"));
  disconnectButton.addEventListener("click", async () => {
    try {
      await disconnect();
      close();
    } catch (err) {
      notify(errorMessage(err), "error");
    }
  });
  const wrongNetwork = a.chainId !== undefined && a.chainId !== chainId;
  const dialog = h(
    "dialog",
    { class: "wallet-dialog", "aria-label": t("wallet.title"), tabindex: "-1" },
    h("div", { class: "dialog-head" }, h("h3", {}, t("wallet.title")), h("button", { type: "button", class: "close", "aria-label": t("wallet.close"), onclick: close }, "✕")),
    h("div", { class: "address-row" }, h("span", { class: "mono" }, a.address), copyButton),
    h(
      "table",
      { class: "kv" },
      h(
        "tbody",
        {},
        h("tr", {}, h("th", {}, t("wallet.kind")), value(a.connector?.name ?? "-")),
        h("tr", {}, h("th", {}, t("wallet.network")), value(wrongNetwork ? t("wallet.wrongNetwork", { chain: a.chainId, name: chain.name }) : chain.name)),
        h("tr", {}, h("th", {}, t("wallet.balance")), balance),
        contractAddress !== zeroAddress ? h("tr", {}, h("th", {}, t("wallet.tokens")), owned) : null,
      ),
    ),
    h(
      "div",
      { class: "actions" },
      h("a", { class: "button secondary", href: addressUrl(a.address), target: "_blank", rel: "noopener" }, t("wallet.explorer")),
      contractAddress !== zeroAddress ? h("a", { class: "button secondary", href: "gallery.html" }, t("wallet.myTokens")) : null,
      disconnectButton,
    ),
  );
  // Clicking the backdrop (outside the box) closes the dialog.
  dialog.addEventListener("click", (e) => e.target === dialog && close());
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  dialog.focus(); // focus the box itself, not the close button: no focus ring on opening

  publicClient.getBalance({ address: a.address }).then(
    (wei) => (balance.textContent = `${formatNumber(formatEther(wei), { maximumFractionDigits: 4 })} ${chain.nativeCurrency.symbol}`),
    () => (balance.textContent = t("wallet.unavailable")),
  );
  if (contractAddress !== zeroAddress) {
    read("balanceOf", [a.address]).then((n) => (owned.textContent = formatNumber(n)), () => (owned.textContent = t("wallet.unavailable")));
  }
}

/** Short message in the corner of the screen. kind: "info", "success" or "error". */
export function notify(message, kind = "info") {
  const box = document.getElementById("toasts");
  const toast = h("div", { class: `toast ${kind}` }, message);
  box.append(toast);
  setTimeout(() => toast.remove(), kind === "error" ? 9000 : 5000);
}

/** Replaces the content of a container. */
export function render(container, ...children) {
  container.replaceChildren(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
}
