// Copies the contract ABI (from the Foundry build) and the whitepaper PDF into the site.
// Run automatically before `npm run dev` and `npm run build`; requires `forge build` at the repository root.
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const site = new URL("../", import.meta.url);

const artifact = JSON.parse(readFileSync(new URL("out/ArtPoW.sol/ArtPoW.json", root), "utf8"));
writeFileSync(new URL("src/lib/abi.json", site), JSON.stringify(artifact.abi, null, 2) + "\n");
// Creation bytecode for the deployment page: the exact output of the pinned compiler, as Polygonscan verifies it.
writeFileSync(new URL("src/lib/bytecode.json", site), JSON.stringify({ bytecode: artifact.bytecode.object }) + "\n");

mkdirSync(new URL("public/", site), { recursive: true });
copyFileSync(new URL("docs/whitepaper/whitepaper.pdf", root), new URL("public/whitepaper.pdf", site));
console.log("synced abi.json, bytecode.json and whitepaper.pdf");

// whitepaper.html carries the HTML generated from the LaTeX source (scripts/whitepaper.mjs, which needs pdflatex):
// warn when the source changed since.
const tex = readFileSync(new URL("docs/whitepaper/whitepaper.tex", root), "utf8");
const hash = createHash("sha256").update(tex).digest("hex").slice(0, 16);
if (!readFileSync(new URL("whitepaper.html", site), "utf8").includes(`sha256 ${hash}`)) {
  console.warn("warning: whitepaper.tex changed since whitepaper.html was generated: run `npm run whitepaper`");
}
