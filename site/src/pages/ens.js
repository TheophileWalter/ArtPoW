// ENS records page: sets one chain's address on the name's resolver (ENS v2 PermissionedResolver.setAddress), which
// the ENS app cannot do (it applies a single address to every EVM chain) and Etherscan cannot call (it does not
// detect the resolver's proxy). Runs on Ethereum mainnet, with its own wallet connection: not linked, noindex.
// Deliberately independent of layout.js and wallet.js, which connect to the collection's network.
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/jetbrains-mono/400.css";
import { createAppKit } from "@reown/appkit";
import { mainnet } from "@reown/appkit/networks";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { getConnection, sendTransaction, switchChain, waitForTransactionReceipt, watchConnection } from "@wagmi/core";
import { createPublicClient, encodeFunctionData, getAddress, http, isAddress, stringToBytes, toHex } from "viem";
import { contractAddress, walletConnectProjectId } from "../lib/config.js";

const RPC = "https://ethereum-rpc.publicnode.com";
const CHAINS = { "Polygon (137)": 2147483785n, "Ethereum (60)": 60n, "Default for every EVM chain": 2147483648n };
const abi = [
  {
    type: "function",
    name: "setAddress",
    stateMutability: "nonpayable",
    inputs: [{ name: "name", type: "bytes" }, { name: "coinType", type: "uint256" }, { name: "addressBytes", type: "bytes" }],
    outputs: [],
  },
];

const client = createPublicClient({ chain: mainnet, transport: http(RPC) });
const adapter = new WagmiAdapter({ networks: [mainnet], projectId: walletConnectProjectId, transports: { [mainnet.id]: http(RPC) } });
const config = adapter.wagmiConfig;
const modal = createAppKit({
  adapters: [adapter],
  networks: [mainnet],
  defaultNetwork: mainnet,
  projectId: walletConnectProjectId,
  metadata: { name: "ArtPoW", description: "ENS records of the ArtPoW project", url: location.origin, icons: [] },
  features: { analytics: false, email: false, socials: false, swaps: false, onramp: false },
});

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
const render = (el, ...children) => el.replaceChildren(...children.flat().filter((c) => c !== null && c !== undefined));

/** DNS wire format of a name, as ENS v2 resolvers take it: each label prefixed by its length, then a zero byte. */
function dnsEncode(name) {
  const parts = name.split(".").map((label) => {
    const bytes = stringToBytes(label);
    if (bytes.length === 0 || bytes.length > 63) throw new Error(`Invalid label "${label}".`);
    return [bytes.length, ...bytes];
  });
  return toHex(new Uint8Array([...parts.flat(), 0]));
}

const inputs = {
  name: h("input", { value: "artpow.eth", spellcheck: "false" }),
  chain: h("select", {}, Object.keys(CHAINS).map((k) => h("option", { value: k }, k))),
  address: h("input", { value: contractAddress, spellcheck: "false" }),
};
const walletBox = h("p", { class: "muted" });
const recordsBox = h("div", {});
const checkBox = h("div", {});
const connectButton = h("button", { type: "button", class: "secondary" }, "Connect");
const checkButton = h("button", { type: "button" }, "Check");
const sendButton = h("button", { type: "button", disabled: true }, "Send");
let prepared = null;

const field = (label, input) => h("div", {}, h("label", {}, label), input);
const errorText = (err) => err?.shortMessage ?? err?.message ?? String(err);

async function showRecords() {
  const name = inputs.name.value.trim();
  render(recordsBox, h("p", { class: "muted" }, "Reading the records…"));
  try {
    const rows = await Promise.all(
      Object.entries(CHAINS).map(async ([label, coinType]) => [label, (await client.getEnsAddress({ name, coinType }).catch(() => null)) ?? "-"]),
    );
    const resolver = await client.getEnsResolver({ name });
    render(
      recordsBox,
      h("table", { class: "kv" }, h("tbody", {},
        h("tr", {}, h("th", {}, "Resolver"), h("td", { class: "mono" }, resolver)),
        rows.map(([label, value]) => h("tr", {}, h("th", {}, label), h("td", { class: "mono" }, value))))),
    );
    return resolver;
  } catch (err) {
    render(recordsBox, h("div", { class: "notice warn" }, `Cannot read ${name}: ${errorText(err)}`));
    return null;
  }
}

async function check() {
  prepared = null;
  sendButton.disabled = true;
  const from = getConnection(config).address;
  if (!from) return render(checkBox, h("div", { class: "notice warn" }, "Connect the wallet that manages the name first."));
  const value = inputs.address.value.trim();
  if (!isAddress(value)) return render(checkBox, h("div", { class: "notice warn" }, "The address is not valid."));
  const resolver = await showRecords();
  if (!resolver) return;
  try {
    const name = inputs.name.value.trim();
    const coinType = CHAINS[inputs.chain.value];
    const data = encodeFunctionData({ abi, functionName: "setAddress", args: [dnsEncode(name), coinType, getAddress(value)] });
    // Simulates from the connected address: a missing permission or a wrong name fails here, before signing.
    await client.call({ account: from, to: resolver, data });
    const gas = await client.estimateGas({ account: from, to: resolver, data });
    prepared = { to: resolver, data, gas: (gas * 130n) / 100n };
    render(checkBox, h("div", { class: "notice ok" },
      h("p", {}, `Simulation succeeded from ${from}: ${inputs.chain.value} of ${name} → ${getAddress(value)}.`),
      h("p", { class: "mono" }, `resolver ${resolver} · gas ${gas}`),
      h("p", {}, "Other chains' records are not touched.")));
    sendButton.disabled = false;
  } catch (err) {
    render(checkBox, h("div", { class: "notice warn" }, `The transaction would fail: ${errorText(err)}`));
  }
}

async function send() {
  if (!prepared) return;
  sendButton.disabled = true;
  render(checkBox, h("div", { class: "notice" }, "Confirm in your wallet (Tangem: tap the card when asked)."));
  try {
    if (getConnection(config).chainId !== mainnet.id) await switchChain(config, { chainId: mainnet.id });
    const hash = await sendTransaction(config, { ...prepared, chainId: mainnet.id });
    render(checkBox, h("div", { class: "notice" }, "Sent, waiting for confirmation: ", h("a", { href: `https://etherscan.io/tx/${hash}`, target: "_blank", rel: "noopener" }, hash)));
    const receipt = await waitForTransactionReceipt(config, { hash });
    render(checkBox, h("div", { class: receipt.status === "success" ? "notice ok" : "notice warn" },
      receipt.status === "success" ? "Done. " : "The transaction failed. ",
      h("a", { href: `https://etherscan.io/tx/${hash}`, target: "_blank", rel: "noopener" }, "View on Etherscan")));
    await showRecords();
  } catch (err) {
    render(checkBox, h("div", { class: "notice warn" }, errorText(err)));
    sendButton.disabled = false;
  }
}

const refreshWallet = () => {
  const a = getConnection(config);
  connectButton.textContent = a.address ? `${a.address.slice(0, 6)}…${a.address.slice(-4)}` : "Connect";
  render(walletBox, a.address ? `Connected: ${a.address} on chain ${a.chainId}.` : "Not connected. The wallet must manage the name (ENS records are on Ethereum mainnet).");
};
watchConnection(config, { onChange: refreshWallet });
Object.values(inputs).forEach((el) => el.addEventListener("input", () => { prepared = null; sendButton.disabled = true; }));
connectButton.addEventListener("click", () => modal.open());
checkButton.addEventListener("click", check);
sendButton.addEventListener("click", send);

render(
  document.getElementById("app"),
  h("div", { class: "kicker", style: "margin-top:0" }, "// restricted"),
  h("h1", {}, "ENS address record"),
  h("div", { class: "notice warn" }, "Ethereum mainnet. Sets the address of one chain on the name's resolver; the other chains keep theirs. Afterwards, do not save the Addresses tab of the ENS app: it applies one address to every EVM chain and would overwrite this record."),
  h("div", { class: "card" },
    h("div", { class: "row" }, connectButton, walletBox),
    h("div", { class: "grid2" }, field("Name", inputs.name), field("Chain", inputs.chain)),
    field("Address", inputs.address),
    h("div", { class: "actions" }, checkButton, sendButton),
    checkBox),
  h("h3", { style: "margin-top:24px" }, "Current records"),
  recordsBox,
);
refreshWallet();
showRecords();
