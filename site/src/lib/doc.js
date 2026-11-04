// Text pages (legal notice, privacy, contact, artists): a heading, a lead and titled sections.
import { h, render } from "./layout.js";

/** `body` holds paragraphs (strings) and lists (arrays of strings). */
export const section = (title, ...body) =>
  h("section", { class: "doc-section" }, h("h2", {}, title),
    body.map((item) => (Array.isArray(item) ? h("ul", {}, item.map((text) => h("li", {}, text))) : typeof item === "string" ? h("p", {}, item) : item)));

export function docPage({ kicker, title, lead, note, sections }) {
  render(
    document.getElementById("app"),
    h("article", { class: "doc" },
      h("div", { class: "kicker", style: "margin-top:0" }, kicker),
      h("h1", {}, title),
      lead ? h("p", { class: "lead" }, lead) : null,
      note ? h("p", { class: "muted" }, note) : null,
      sections),
  );
}
