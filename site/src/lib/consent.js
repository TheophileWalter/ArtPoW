// Consent to the third-party services behind wallet connections (Reown, WalletConnect). Without it the site loads none
// of their code, so nothing reaches them; browser wallets and the relay work without it. The choice lasts six months.
const KEY = "artpow-consent";
const OPEN_KEY = "artpow-open-wallet";
const MAX_AGE_MS = 182 * 24 * 3600 * 1000;
// What those services keep in the browser: refusing also ends their session.
const SERVICE_STORAGE = /^(wc@|@appkit|@w3m|W3M|WCM|wagmi|reown|-walletlink|cbwsdk)/i;

function read() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    return saved && Date.now() - saved.at < MAX_AGE_MS ? saved.choice : null;
  } catch {
    return null;
  }
}

/** "yes", "no", or null when the visitor has not chosen yet. */
export const consentChoice = read;
export const hasConsent = () => read() === "yes";

/**
 * Records the choice. The services are only loaded when a page starts, so accepting, or refusing them once loaded, needs
 * a reload. `openWallet` opens the wallet window after it, since accepting usually comes from asking to connect.
 */
export function setConsent(choice, { openWallet = false, reload = true } = {}) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ choice, at: Date.now() }));
    if (openWallet) sessionStorage.setItem(OPEN_KEY, "1");
    if (choice === "no") {
      for (const key of Object.keys(localStorage)) if (SERVICE_STORAGE.test(key)) localStorage.removeItem(key);
    }
  } catch {
    // blocked storage: the choice then lasts for this page only
  }
  if (reload) location.reload();
}

/** Whether a page before the reload asked to open the wallet window; only answers yes once. */
export function takeOpenWallet() {
  try {
    const asked = sessionStorage.getItem(OPEN_KEY);
    sessionStorage.removeItem(OPEN_KEY);
    return asked === "1";
  } catch {
    return false;
  }
}

let prompt = null;
/** The layout provides the dialog; the wallet code only asks for it. */
export const onConsentNeeded = (show) => { prompt = show; };
export const askConsent = () => prompt?.();
