// Translations of the public pages. The language is, in order: ?lang= in the address, the visitor's choice
// (remembered), the browser's preferred languages, English. Missing keys fall back to English. Usable in Node (tests):
// without a browser the language is English.
import en from "./i18n/en.js";
import es from "./i18n/es.js";
import fr from "./i18n/fr.js";
import it from "./i18n/it.js";

export const LANGUAGES = { en: "English", fr: "Français", es: "Español", it: "Italiano" };
const DICTIONARIES = { en, fr, es, it };
const STORAGE_KEY = "lang";

function detect() {
  if (typeof window === "undefined") return "en";
  const fromUrl = new URLSearchParams(location.search).get("lang");
  if (fromUrl in LANGUAGES) return fromUrl;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved in LANGUAGES) return saved;
  } catch {
    // blocked storage: fall through to the browser languages
  }
  for (const l of navigator.languages ?? [navigator.language]) {
    const code = String(l).slice(0, 2).toLowerCase();
    if (code in LANGUAGES) return code;
  }
  return "en";
}

export const lang = detect();
if (typeof document !== "undefined") document.documentElement.lang = lang;

/** Translated text for `key`, with {name} placeholders replaced by `vars`. */
export function t(key, vars = {}) {
  const text = DICTIONARIES[lang][key] ?? en[key];
  if (text === undefined) {
    console.warn(`i18n: missing key ${key}`);
    return key;
  }
  return text.replace(/\{(\w+)\}/g, (_, name) => (name in vars ? String(vars[name]) : `{${name}}`));
}

export const hasKey = (key) => key in en;

/** Plural form: `key.one` when n is 1, `key.other` otherwise; {n} is the formatted number. */
export const tn = (key, n, vars = {}) => t(`${key}.${n === 1 ? "one" : "other"}`, { n: formatNumber(n), ...vars });

export const formatNumber = (n, options) => Number(n).toLocaleString(lang, options);

/** Remembers the visitor's choice and reloads the page in that language. */
export function setLanguage(code) {
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // the choice then lasts for this page only, through the address
  }
  const url = new URL(location.href);
  url.searchParams.delete("lang");
  if (url.href === location.href) location.reload();
  else location.replace(url.href);
}

/** Translates static markup: elements with data-i18n get their text, data-i18n-attr="attr:key" an attribute. */
export function translateDocument(root = document) {
  for (const el of root.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll("[data-i18n-attr]")) {
    const [attr, key] = el.dataset.i18nAttr.split(":");
    el.setAttribute(attr, t(key));
  }
}
