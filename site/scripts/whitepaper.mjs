// Converts the LaTeX whitepaper into the HTML of whitepaper.html, so the page shows the paper itself (responsive,
// themed, selectable) instead of an embedded PDF. The .tex stays the only source: run `npm run whitepaper` after
// editing it. Handles the subset of LaTeX the paper uses; anything else stops the conversion with an error.
// Requires pdflatex (figures: TikZ compiled with the standalone class) and pdftocairo (PDF to SVG).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import katex from "katex";

const root = new URL("../../", import.meta.url);
const site = new URL("../", import.meta.url);
const texPath = new URL("docs/whitepaper/whitepaper.tex", root);
const pagePath = new URL("whitepaper.html", site);
const figureDir = new URL("public/whitepaper-figures/", site);
const START = "<!-- whitepaper:start";
const END = "<!-- whitepaper:end -->";

const source = readFileSync(texPath, "utf8");
const sourceHash = createHash("sha256").update(source).digest("hex").slice(0, 16);
const preamble = source.slice(0, source.indexOf("\\begin{document}"));
let body = source.slice(source.indexOf("\\begin{document}") + 16, source.indexOf("\\end{document}"));
body = body.replace(/(^|[^\\])%.*$/gm, "$1"); // comments

// --- Inline text ----------------------------------------------------------------------------------------------

const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const math = (tex, displayMode = false) =>
  katex.renderToString(tex.trim(), { output: "mathml", displayMode, throwOnError: true, strict: "ignore" });

// Section labels, collected first: the text refers to sections defined later.
const labels = {};
{
  let n = 0;
  for (const m of body.matchAll(/\\section(\*?)\{[^}]*\}(\\label\{([^}]+)\})?/g)) {
    if (!m[1]) n++;
    if (m[3]) labels[m[3]] = n;
  }
}
const anchor = (label) => `sec-${label.replace(/^sec:/, "")}`;

function inline(text) {
  const saved = [];
  const keep = (html) => `\u0000${saved.push(html) - 1}\u0000`;
  let s = text.replace(/\$([^$]+)\$/g, (_, tex) => keep(math(tex)));
  s = s.replace(/\\ref\{([^}]+)\}/g, (_, label) => {
    if (!(label in labels)) throw new Error(`unknown label ${label}`);
    return keep(`<a href="#${anchor(label)}">${labels[label]}</a>`);
  });
  s = escape(s);
  // Commands with one argument, innermost first.
  const commands = { textbf: "strong", emph: "em", texttt: "code", fn: "code" };
  for (let i = 0; i < 5; i++) {
    s = s.replace(/\\(textbf|emph|texttt|fn)\{([^{}]*)\}/g, (_, cmd, arg) => `<${commands[cmd]}>${arg}</${commands[cmd]}>`);
  }
  s = s
    .replace(/``/g, "“").replace(/''/g, "”")
    .replace(/--/g, "–")
    .replace(/\\,/g, " ")
    .replace(/\\([%#&_$])/g, "$1")
    .replace(/\\relax\b/g, "")
    .replace(/~\[(\d+)\]/g, (_, n) => ` <a href="#ref-${n}" class="cite">[${n}]</a>`)
    .replace(/~/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/\\[a-zA-Z]/.test(s)) throw new Error(`unsupported command in: ${s.match(/\\[a-zA-Z]+/)[0]} … ${text.trim().slice(0, 60)}`);
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => saved[i]);
}

// --- Figures --------------------------------------------------------------------------------------------------

/** Compiles a TikZ picture with the paper's packages and returns it as SVG (text converted to paths). */
function tikzToSvg(picture, index) {
  const dir = mkdtempSync(join(tmpdir(), "artpow-fig-"));
  try {
    const packages = preamble.match(/\\usepackage(\[[^\]]*\])?\{(fontenc|inputenc|mathptmx|amsmath|tikz)\}|\\usetikzlibrary\{[^}]*\}/g).join("\n");
    writeFileSync(join(dir, "fig.tex"), `\\documentclass[border=4pt]{standalone}\n${packages}\n\\begin{document}\n${picture}\n\\end{document}\n`);
    execFileSync("pdflatex", ["-interaction=nonstopmode", "-halt-on-error", "fig.tex"], { cwd: dir, stdio: "ignore" });
    execFileSync("pdftocairo", ["-svg", "fig.pdf", "fig.svg"], { cwd: dir });
    const svg = readFileSync(join(dir, "fig.svg"), "utf8");
    const name = `figure-${index}.svg`;
    writeFileSync(new URL(name, figureDir), svg);
    return name;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- Blocks ---------------------------------------------------------------------------------------------------

const out = [];
let sectionNumber = 0;
let figures = 0;
mkdirSync(figureDir, { recursive: true });

const title = body.match(/\{\\Large\\bfseries ([^}]*)\}\\\\\[[^\]]*\]\s*([^\\\n]*)\\\\/);
if (!title) throw new Error("title block not found");
out.push(`<header class="paper-title"><h1>${inline(title[1])}</h1><p>${inline(title[2])}</p></header>`);
body = body.slice(body.indexOf("\\end{center}") + "\\end{center}".length).replace(/\\vspace\{[^}]*\}/g, "");

const BLOCKS = [
  [/\\begin\{list\}\{\}\{[^\n]*\}\\item\\relax([\s\S]*?)\\end\{list\}/y, (m) => `<div class="abstract">${paragraphs(m[1])}</div>`],
  [/\\section(\*?)\{([^}]*)\}(?:\\label\{([^}]+)\})?/y, (m) => {
    const number = m[1] ? "" : `${++sectionNumber}. `;
    const id = m[3] ? anchor(m[3]) : m[2].toLowerCase().replace(/[^a-z]+/g, "-");
    return `<h2 id="${id}">${number}${inline(m[2])}</h2>`;
  }],
  [/\\subsection\*\{([^}]*)\}/y, (m) => `<h3>${inline(m[1])}</h3>`],
  [/\\begin\{itemize\}([\s\S]*?)\\end\{itemize\}/y, (m) => `<ul>${items(m[1]).map((i) => `<li>${inline(i)}</li>`).join("")}</ul>`],
  [/\\begin\{enumerate\}(?:\[[^\n]*\])?([\s\S]*?)\\end\{enumerate\}/y, (m) =>
    `<ol class="references">${items(m[1]).map((i, n) => `<li id="ref-${n + 1}"><span>[${n + 1}]</span> ${inline(i)}</li>`).join("")}</ol>`],
  [/\\begin\{figure\}(?:\[[^\]]*\])?([\s\S]*?)\\end\{figure\}/y, (m) => {
    const picture = m[1].match(/\\begin\{tikzpicture\}[\s\S]*\\end\{tikzpicture\}/)[0];
    const caption = m[1].match(/\\caption\*\{(?:\\small\s*)?([\s\S]*?)\}\s*$/m)?.[1] ?? "";
    const file = tikzToSvg(picture, ++figures);
    return `<figure><img src="whitepaper-figures/${file}" alt="${escape(caption)}" loading="lazy" /><figcaption>${inline(caption)}</figcaption></figure>`;
  }],
  [/\\begin\{center\}\s*\\begin\{tabular\}\{([a-z]+)\}([\s\S]*?)\\end\{tabular\}\s*\\end\{center\}/y, (m) => table(m[1], m[2])],
  [/\\\[([\s\S]*?)\\\]/y, (m) => math(m[1], true)],
];

function items(list) {
  return list.split(/\\item\b/).slice(1).map((s) => s.trim());
}

function paragraphs(text) {
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${inline(p)}</p>`).join("\n");
}

function table(spec, rows) {
  const [head, rest] = rows.replace(/\\(toprule|bottomrule)/g, "").split("\\midrule");
  const cells = (row) => row.split("&").map((c) => c.trim());
  const align = (i) => (spec[i] === "r" ? ' class="num"' : "");
  const tr = (row, tag) => `<tr>${cells(row).map((c, i) => `<${tag}${align(i)}>${inline(c)}</${tag}>`).join("")}</tr>`;
  const body = rest.split("\\\\").map((r) => r.trim()).filter(Boolean);
  return `<div class="table-wrap"><table><thead>${tr(head.replace(/\\\\\s*$/, ""), "th")}</thead><tbody>${body.map((r) => tr(r, "td")).join("")}</tbody></table></div>`;
}

// Text between blocks is made of paragraphs; display math ends a paragraph and the text after it continues the
// same paragraph in LaTeX, which reads the same as a new one here.
let pos = 0;
let text = "";
const flush = () => {
  if (text.trim()) out.push(paragraphs(text));
  text = "";
};
while (pos < body.length) {
  let matched = false;
  if (body[pos] === "\\") {
    for (const [re, render] of BLOCKS) {
      re.lastIndex = pos;
      const m = re.exec(body);
      if (m) {
        flush();
        out.push(render(m));
        pos = re.lastIndex;
        matched = true;
        break;
      }
    }
  }
  if (!matched) text += body[pos++];
}
flush();

// --- Page -----------------------------------------------------------------------------------------------------

const html = `${START} generated by scripts/whitepaper.mjs from docs/whitepaper/whitepaper.tex (sha256 ${sourceHash}): do not edit -->
      <article class="paper">
${out.join("\n")}
      </article>
      ${END}`;
const page = readFileSync(pagePath, "utf8");
const a = page.indexOf(START);
const b = page.indexOf(END);
if (a < 0 || b < 0) throw new Error("markers not found in whitepaper.html");
writeFileSync(pagePath, page.slice(0, a) + html + page.slice(b + END.length));
console.log(`whitepaper.html: ${sectionNumber} sections, ${figures} figures (source ${sourceHash})`);

