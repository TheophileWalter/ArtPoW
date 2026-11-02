# ArtPoW website

Static website for the collection: presentation, whitepaper, gallery, in-browser mining and claiming, and an
administration page. No server: the build is a folder of HTML, CSS and JavaScript that can be hosted anywhere
(IPFS, GitHub Pages, Netlify, any web server).

| Page | Content |
|---|---|
| `index.html` | Presentation and the current edition |
| `how.html` | The system explained for everyone: a hashing demo, a difficulty calculator and month scenarios (charts computed with the contract's rule, `src/lib/explainer.js`) |
| `mine.html` | Mines a proof in the browser (WebAssembly, several Web Workers), then claims the token |
| `gallery.html` | Every edition, a token viewer (`/gallery#token=12`) and the tokens of the connected wallet |
| `stats.html` | Statistics read live from the contract and its events: totals, averages, difficulty record, rarest hash, holders, tokens per month, rarity distribution, and for each month the tokens minted against the schedule and the difficulty over time (claim times from the `Claimed` events, closed months cached in the browser) |
| `whitepaper.html` | The whitepaper as HTML (text, MathML formulas, SVG figures), generated from the LaTeX source, and the PDF to download |
| `admin.html` | Every administrator function, sent from the wallet or exported as calldata for a multisig. Not linked from the other pages and marked `noindex`: open it by its address |
| `deploy.html` | Deploys the contract from the connected wallet (e.g. a Tangem card through WalletConnect). Not linked, `noindex`, dev only (see below) |
| `ens.html` | Sets one chain's address on an ENS v2 resolver (`setAddress`), on Ethereum mainnet with its own wallet connection. Not linked, `noindex`, dev only (see below) |

Dark and light themes: the site follows the system preference, and a button in the header switches between them
(the choice is remembered in the browser and applied before the first paint, without a flash). Mobile-first layout
(collapsible menu, single-column pages, admin tables stacked into cards on small screens). Fonts are bundled (Space Grotesk, JetBrains Mono): the site makes no third-party request except
to the RPC endpoint, the wallet and the image gateways.

## Languages

The public pages (home, how it works, mine, gallery, the whitepaper page's labels, header, footer, wallet dialog and
contract error messages) exist in English, French, Spanish and Italian. The language is, in order: `?lang=xx` in
the address, the visitor's choice in the header (remembered in the browser), the browser's languages, English.
Texts live in `src/lib/i18n/{en,fr,es,it}.js`; English is the reference and `test/i18n.test.js` checks that every
language has the same keys and placeholders, and that every key used in the code exists. The whitepaper itself, the
administration, deployment and ENS pages and on-chain data (labels, attributes) stay in English.

## Configuration

Copy `.env.example` to `.env`:

- `VITE_CHAIN_ID`: `137` (Polygon), `80002` (Amoy testnet) or `31337` (local Anvil node);
- `VITE_CONTRACT`: address of the deployed contract;
- `VITE_RPC_URL` (optional): RPC endpoint for reads; the network's public endpoint by default;
- `VITE_DEPLOY_BLOCK` (optional): deployment block, shown on the deployment page (no longer needed to list tokens);
- `VITE_WALLETCONNECT_PROJECT_ID`: Reown (WalletConnect) project id, free at <https://dashboard.reown.com>.
  With it, the connection modal offers mobile wallets through a QR code as well as browser wallets; without it,
  only browser wallets (MetaMask, Rabby…) are available;
- `VITE_IPFS_GATEWAY`, `VITE_ARWEAVE_GATEWAY`: gateways used to display `ipfs://` and `ar://` images;
- `VITE_SOURCE_URL`: public repository, linked from the footer (default: https://github.com/TheophileWalter/ArtPoW).

## Build

Requires `forge build` at the repository root (the ABI is taken from the Foundry build) and the compiled
whitepaper (`docs/whitepaper/whitepaper.pdf`).

```shell
npm install
npm run dev       # development server
npm run build     # static site in dist/
```

The build uses relative paths, so `dist/` works from any folder. Links between pages have no `.html` extension: the
server has to resolve them (see below), which a plain IPFS gateway does not do.

`deploy.html` and `ens.html` are one-off tools: `npm run dev` serves them, but `npm run build` leaves them out of
`dist/`. To publish them for a while (e.g. to use them from a phone wallet on the real domain), build with
`RESTRICTED_PAGES=1 npm run build`, then rebuild without it and upload again.

`public/.htaccess` (copied into `dist/`, a hidden file: make sure the FTP client uploads it) configures Apache:
- HTTPS only: plain HTTP is redirected (301), and browsers are told to use HTTPS directly for a year (HSTS). The rule
  tests the port and `X-Forwarded-Proto`, which works behind hosts that terminate TLS in front of Apache (OVH);
- every token's metadata links to `<website>/token/<id>`: it is redirected to `gallery#token=<id>`;
- folders are not listed;
- addresses have no `.html`: `/how` serves `how.html`, and `/how.html` is redirected (301) to `/how`, as is `/how/`.

Other servers need the same rules.

## Whitepaper

The page shows the paper itself, not an embedded PDF. `npm run whitepaper` converts `docs/whitepaper/whitepaper.tex`
into the content of `whitepaper.html` (formulas rendered to MathML by KaTeX at conversion time, TikZ figures compiled
with `pdflatex` and converted to SVG in `public/whitepaper-figures/`, not `whitepaper/`, which would make `/whitepaper` a folder). Run it after editing the paper, and rebuild the PDF
with `pdflatex`; `npm run build` warns when the HTML is older than the source. The converter handles the LaTeX the
paper uses and stops with an error on anything else.

## Local demo

`npm run demo` starts a local Anvil node, deploys the contract with sample content (an open month, an upcoming
one, generated artworks, both proofs minted) and prints the command to start the site against it:

```shell
npm run demo                     # terminal 1, keeps the node running
VITE_CHAIN_ID=31337 VITE_CONTRACT=<printed address> VITE_RPC_URL=http://127.0.0.1:8545 npm run dev   # terminal 2
```

To claim or administer, import one of Anvil's development accounts into a browser wallet (the first one is the
administrator).

## How mining works

The page reads the month's seed and current target, and aims at the target the contract would have after two
more claims (each claim makes the next one about 7% harder), so that a proof found is still valid when it is
included. Every 15 seconds it reads the target again. Each Web Worker searches its own random nonce space with the
WebAssembly miner of `../miner`. A proof is checked against the current target before it is offered, and saved in
the browser so it can still be submitted after closing the tab. The wallet only signs the final claim; anyone may
submit a claim for any recipient.

Month status (upcoming, active, closed) is judged by the latest block's timestamp, not by the visitor's clock.

## Administration page

The page shows the contract state (administrators, owner, team address, months) and offers every administrator
function: scheduling and editing months (with the same checks as the contract, image preview, UTC dates), proofs
and total announcements (open to anyone), collection info, `owner()`, team address, two-step administrator
nomination, revocation, asset recovery and the emergency shutdown (typed confirmation).

When the administrator is a multisig, the signer's own wallet is not an administrator: use **Calldata for a
multisig** and paste the address and data into the Safe transaction builder.

## Deploying from a hardware wallet without Foundry support (Tangem)

Foundry signs with private keys, Ledger or Trezor. A Tangem card only signs through its app, over WalletConnect:
`deploy.html` sends the deployment from the connected wallet.

1. In `site/.env`: `VITE_CHAIN_ID=137`, `VITE_WALLETCONNECT_PROJECT_ID=<Reown project id>` (if the Reown project
   restricts domains, allow `http://localhost:5173`). `VITE_CONTRACT` can stay empty.
2. `npm run dev`, then open `http://localhost:5173/deploy.html` on the computer.
3. **Connect**, choose WalletConnect and scan the QR code from the Tangem app (Polygon network).
4. Read the name, symbol and description (permanent), then **Check the deployment**: it simulates the constructor
   from the connected address and compares the fee cap with the balance.
5. **Deploy**, type the collection name to confirm, approve in the Tangem app and tap the card.
6. The page reads the contract back and shows the `forge verify-contract` command to run at the repository root
   (with `ETHERSCAN_API_KEY` in the root `.env`), then the values to put in `site/.env`.

The page sends the creation bytecode of the Foundry build (pinned compiler), so the source verification matches. The
end-to-end test deploys through the same code and checks that the transaction data is exactly this bytecode
followed by the constructor arguments.

## Tests

```shell
npm test          # unit tests of the scheduling checks, URI resolution, targets and metadata decoding
npm run e2e       # end-to-end against a local Anvil node, production difficulty (~1 min of mining)
```

The end-to-end test deploys the contract, checks that the administration page's validation agrees with the
contract, mines a real proof with the WebAssembly miner, claims it on behalf of a recipient, mints a team proof,
and reads everything back through the site's modules.

The wallet interactions (AppKit modal, signing) need a real browser and wallet: try them on Amoy before mainnet.
