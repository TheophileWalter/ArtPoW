import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const page = (name) => fileURLToPath(new URL(`./${name}.html`, import.meta.url));

// One-off pages (contract deployment, ENS records) are served by `npm run dev` but left out of the production
// build; RESTRICTED_PAGES=1 npm run build includes them when they are needed online.
const restricted = process.env.RESTRICTED_PAGES === "1" ? { deploy: page("deploy"), ens: page("ens") } : {};

export default defineConfig({
  base: "./", // relative paths: the build can be hosted anywhere, IPFS included
  resolve: { alias: { "@miner": fileURLToPath(new URL("../miner/src", import.meta.url)) } },
  server: { fs: { allow: [".."] } },
  worker: { format: "es" },
  build: {
    rollupOptions: {
      input: {
        index: page("index"),
        how: page("how"),
        whitepaper: page("whitepaper"),
        gallery: page("gallery"),
        mine: page("mine"),
        stats: page("stats"),
        admin: page("admin"),
        ...restricted,
      },
    },
  },
});
