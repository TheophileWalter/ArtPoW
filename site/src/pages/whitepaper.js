// Whitepaper page: the paper itself is static HTML in whitepaper.html, generated from the LaTeX source by
// scripts/whitepaper.mjs; this script adds the shared header and footer and translates the page's own labels. The
// paper stays in English, the project's reference language.
import { lang } from "../lib/i18n.js";
import { initLayout } from "../lib/layout.js";

initLayout("whitepaper.html");
document.getElementById("english-only").hidden = lang === "en";
