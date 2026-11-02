// Deployment page: deploys the contract from the connected wallet (a Tangem card through WalletConnect, or any
// wallet), after a simulation, a cost estimate and a typed confirmation. Not linked from the other pages.
import { formatEther } from "viem";
import { chain, chainId } from "../lib/config.js";
import { ADMIN_ROLE, abi, publicClient } from "../lib/contract.js";
import { DEFAULTS, bytecode, constructorArgs, deployData, validateDeployment, verifyCommand } from "../lib/deployment.js";
import { h, initLayout, notify, render } from "../lib/layout.js";
import { addressUrl, errorMessage, shortAddress, txUrl } from "../lib/util.js";
import { account, connect, deploy, onAccountChange } from "../lib/wallet.js";

initLayout("deploy");
const app = document.getElementById("app");
const STORAGE_KEY = `artpow-deployment:${chainId}`;

const inputs = {
  name: h("input", { value: DEFAULTS.name, spellcheck: "false" }),
  symbol: h("input", { value: DEFAULTS.symbol, spellcheck: "false" }),
  description: h("textarea", { rows: 3 }, DEFAULTS.description),
  team: h("input", { placeholder: "optional: 0x… receives the team proofs (changeable later)", spellcheck: "false" }),
};
const preview = h("div", {});
const checkBox = h("div", {});
const resultBox = h("div", {});
const checkButton = h("button", { type: "button" }, "Check the deployment");
const deployButton = h("button", { type: "button", disabled: true }, "Deploy");
let checked = null; // values that passed the check
let checkedGas = 0n; // gas estimate of the check, with a margin

const values = () => ({
  name: inputs.name.value,
  symbol: inputs.symbol.value,
  description: inputs.description.value,
  team: inputs.team.value,
});

function refresh() {
  checked = null;
  deployButton.disabled = true;
  render(checkBox);
  const v = values();
  const problems = validateDeployment(v);
  render(
    preview,
    problems.length
      ? h("ul", { class: "problems" }, problems.map((p) => h("li", {}, p)))
      : h(
          "div",
          { class: "calldata" },
          `name():        ${v.name}\nsymbol():      ${v.symbol}\ndescription:   ${v.description}\nteam proofs:   ${v.team.trim() || "none"}\n\n${v.description.length} characters of description, permanent.`,
        ),
  );
  return problems;
}

async function check() {
  if (refresh().length) return;
  const from = account().address;
  if (!from) {
    await connect().catch((err) => notify(errorMessage(err), "error"));
    return notify("Connect your wallet, then check again.");
  }
  render(checkBox, h("p", { class: "muted" }, "Simulating the deployment…"));
  try {
    const v = values();
    const data = deployData(v);
    // Runs the constructor as an eth_call from the connected address: catches any revert before signing.
    await publicClient.call({ account: from, data });
    const [gas, fees, balance] = await Promise.all([
      publicClient.estimateGas({ account: from, data }),
      publicClient.estimateFeesPerGas(),
      publicClient.getBalance({ address: from }),
    ]);
    const expected = gas * fees.maxFeePerGas;
    const enough = balance >= expected;
    render(
      checkBox,
      h(
        "div",
        { class: enough ? "notice ok" : "notice warn" },
        h("p", {}, "Simulation succeeded on ", h("strong", {}, chain.name), ` from ${shortAddress(from)}.`),
        h("p", { class: "mono" }, `gas: ${gas.toLocaleString()} · fee cap: ${formatEther(expected)} ${chain.nativeCurrency.symbol} · balance: ${formatEther(balance)} ${chain.nativeCurrency.symbol}`),
        enough
          ? h("p", {}, "The actual cost is usually well below the fee cap.")
          : h("p", {}, "The balance is below the fee cap: the wallet may refuse the transaction. Add funds, then check again."),
        h("p", {}, "The deployer becomes the first administrator and the first owner()."),
      ),
    );
    checked = JSON.stringify(v);
    checkedGas = (gas * 120n) / 100n;
    deployButton.disabled = !enough;
  } catch (err) {
    render(checkBox, h("div", { class: "notice warn" }, `The deployment would fail: ${errorMessage(err)}`));
  }
}

async function run() {
  const v = values();
  if (checked !== JSON.stringify(v)) return notify("Check the deployment again: the values changed.", "error");
  const typed = prompt(`This deploys on ${chain.name} and the name, symbol and description become permanent.\nType the collection name (${v.name}) to confirm.`);
  if (typed !== v.name) return notify("Cancelled.");
  deployButton.disabled = true;
  checkButton.disabled = true;
  render(resultBox, h("div", { class: "notice" }, "Confirm the transaction in your wallet (on the Tangem app: tap the card when asked)."));
  let sent = false;
  const hint = setTimeout(() => {
    if (!sent) render(resultBox, h("div", { class: "notice warn" }, "Still waiting for the wallet. On a phone, open the wallet app yourself: requests are often not shown while it is in the background. If nothing appears, the wallet may not support contract creation over WalletConnect."));
  }, 30000);
  try {
    const receipt = await deploy({
      bytecode,
      args: constructorArgs(v),
      gas: checkedGas,
      onSent: (hash) => {
        sent = true;
        render(resultBox, h("div", { class: "notice" }, "Transaction sent, waiting for confirmation: ", h("a", { href: txUrl(hash), target: "_blank", rel: "noopener" }, hash)));
      },
    });
    if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("The deployment transaction failed.");
    const record = { ...v, address: receipt.contractAddress, block: receipt.blockNumber.toString(), tx: receipt.transactionHash };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(record)); } catch {}
    await showResult(record);
    notify("Contract deployed.", "success");
  } catch (err) {
    console.error(err);
    render(resultBox, h("div", { class: "notice warn" }, errorMessage(err)));
    checkButton.disabled = false;
    deployButton.disabled = false;
  } finally {
    clearTimeout(hint);
  }
}

/** Reads the deployed contract back and shows the next steps. */
async function showResult(record) {
  const read = (functionName, args = []) => publicClient.readContract({ address: record.address, abi, functionName, args });
  let rows;
  try {
    const [name, symbol, owner, admins, seed] = await Promise.all([
      read("name"), read("symbol"), read("owner"), read("getRoleMemberCount", [ADMIN_ROLE]), read("genesisSeed"),
    ]);
    rows = [
      ["name()", name, name === record.name],
      ["symbol()", symbol, symbol === record.symbol],
      ["owner() and first administrator", owner, admins === 1n],
      ["genesis seed", seed, true],
    ];
  } catch (err) {
    rows = [["read back", `not yet readable: ${errorMessage(err)}`, false]];
  }
  render(
    resultBox,
    h(
      "div",
      { class: "card" },
      h("h3", {}, "Deployed"),
      h("p", {}, "Contract: ", h("a", { href: addressUrl(record.address), target: "_blank", rel: "noopener" }, record.address)),
      h("p", { class: "muted" }, `Block ${record.block} · `, h("a", { href: txUrl(record.tx), target: "_blank", rel: "noopener" }, "transaction")),
      h("table", { class: "kv" }, h("tbody", {}, rows.map(([k, val, ok]) => h("tr", {}, h("th", {}, k), h("td", {}, `${ok ? "✓" : "✗"} ${val}`))))),
      h("h3", { style: "margin-top:20px" }, "1. Verify the source code"),
      h("p", { class: "muted" }, "At the repository root, with ETHERSCAN_API_KEY in .env:"),
      h("div", { class: "calldata" }, verifyCommand(record.address, record, chainId)),
      h("h3", { style: "margin-top:20px" }, "2. Point the site at the contract"),
      h("div", { class: "calldata" }, `VITE_CHAIN_ID=${chainId}\nVITE_CONTRACT=${record.address}\nVITE_DEPLOY_BLOCK=${record.block}`),
      h("h3", { style: "margin-top:20px" }, "3. Schedule month 1 soon"),
      h("p", { class: "muted" }, "The seed of month 1 is public from now on: the earlier month 1 opens, the shorter the pre-mining window. Use the administration page once the site points at the contract."),
    ),
  );
}

Object.values(inputs).forEach((el) => el.addEventListener("input", refresh));
checkButton.addEventListener("click", check);
deployButton.addEventListener("click", run);
onAccountChange(refresh);

render(
  app,
  h("div", { class: "kicker", style: "margin-top:0" }, "// restricted"),
  h("h1", {}, "Deploy the contract"),
  h(
    "div",
    { class: "notice warn" },
    h("strong", {}, `Network: ${chain.name}. `),
    "The name, symbol and description can never be changed after deployment, and a deployed contract cannot be deleted: it can only be shut down. Read them carefully.",
  ),
  h(
    "div",
    { class: "card" },
    h("div", { class: "grid2" },
      h("div", {}, h("label", {}, "Name"), inputs.name),
      h("div", {}, h("label", {}, "Symbol"), inputs.symbol)),
    h("label", {}, "Description"),
    inputs.description,
    h("label", {}, "Team proofs recipient"),
    inputs.team,
    preview,
    checkBox,
    h("div", { class: "actions" }, checkButton, deployButton),
  ),
  resultBox,
);
refresh();

try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  if (saved?.address) {
    render(resultBox, h("div", { class: "notice" }, "A deployment from this browser was recorded: ", h("a", { href: addressUrl(saved.address), target: "_blank", rel: "noopener" }, saved.address)));
    showResult(saved);
  }
} catch {}
