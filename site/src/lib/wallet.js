// Wallet connection and transactions. With a WalletConnect (Reown) project id and the visitor's consent, the AppKit
// modal offers mobile wallets (QR code), email accounts and browser wallets. Otherwise the site loads none of that code
// and falls back to the browser wallet only.
import {
  connect as wagmiConnect,
  createConfig,
  deployContract,
  disconnect as wagmiDisconnect,
  getConnection,
  http,
  injected,
  reconnect,
  simulateContract,
  switchChain,
  waitForTransactionReceipt,
  watchConnection,
  writeContract,
} from "@wagmi/core";
import { encodeFunctionData } from "viem";
import { askConsent, consentChoice, hasConsent, takeOpenWallet } from "./consent.js";
import { abi } from "./contract.js";
import { t } from "./i18n.js";
import { chain, chainId, contractAddress, rpcUrl, walletConnectProjectId } from "./config.js";

let config;
let modal = null;

if (walletConnectProjectId && hasConsent()) {
  const [{ createAppKit }, { foundry, polygon, polygonAmoy }, { WagmiAdapter }, { OptionsController }] = await Promise.all([
    import("@reown/appkit"),
    import("@reown/appkit/networks"),
    import("@reown/appkit-adapter-wagmi"),
    import("@reown/appkit-controllers"),
  ]);
  // Their SDKs send usage data to Coinbase as soon as they start. AppKit 1.8.24 has no working option for Base Account:
  // createAppKit never passes enableBaseAccount on, so it is set directly.
  OptionsController.setEnableBaseAccount(false);
  const network = { 137: polygon, 80002: polygonAmoy, 31337: foundry }[chainId];
  const adapter = new WagmiAdapter({
    networks: [network],
    projectId: walletConnectProjectId,
    transports: { [chainId]: http(rpcUrl) },
  });
  config = adapter.wagmiConfig;
  modal = createAppKit({
    adapters: [adapter],
    networks: [network],
    defaultNetwork: network,
    projectId: walletConnectProjectId,
    metadata: {
      name: "ArtPoW",
      description: "A free NFT every month, earned by proof of work.",
      url: location.origin,
      icons: [],
    },
    // Email accounts give beginners an address; a plain one, because the relay refuses contract recipients.
    defaultAccountTypes: { eip155: "eoa" },
    enableCoinbase: false,
    features: { analytics: false, email: true, socials: false, swaps: false, onramp: false },
  });
} else {
  config = createConfig({ chains: [chain], connectors: [injected()], transports: { [chainId]: http(rpcUrl) } });
  reconnect(config);
}

if (modal && takeOpenWallet()) modal.open();

export const account = () => getConnection(config);
export const onAccountChange = (callback) => watchConnection(config, { onChange: callback });

/** Whether mobile wallets and email accounts can be offered: the project id exists, whatever the visitor's consent. */
export const walletServicesExist = () => Boolean(walletConnectProjectId);

export async function connect() {
  if (modal) return modal.open();
  // Nothing is loaded or asked before this point: the question only matters to someone connecting a wallet.
  if (walletConnectProjectId && consentChoice() === null) return askConsent();
  if (!window.ethereum) throw new Error(t(walletConnectProjectId ? "wallet.needConsent" : "wallet.noBrowserWallet"));
  return wagmiConnect(config, { connector: injected(), chainId });
}

/** Whether the connected wallet is an email account, whose only interface is that window. */
export const isEmailAccount = () => account().connector?.type === "AUTH";

/** The wallet's own window, where an email account can also export its key. */
export const openAccount = () => modal?.open({ view: "Account" });

export async function disconnect() {
  return wagmiDisconnect(config);
}

/**
 * Sends a contract transaction from the connected wallet: switches network if needed, simulates first (so that
 * contract errors show up before signing), then waits for the receipt.
 */
export async function write(functionName, args = [], { onSent } = {}) {
  const current = account();
  if (!current.address) {
    await connect();
    throw new Error(t("wallet.connectThenRetry"));
  }
  if (current.chainId !== chainId) await switchChain(config, { chainId });
  const { request } = await simulateContract(config, {
    address: contractAddress,
    abi,
    functionName,
    args,
    account: current.address,
  });
  const hash = await writeContract(config, request);
  onSent?.(hash);
  return waitForTransactionReceipt(config, { hash });
}

/**
 * Deploys the contract from the connected wallet (e.g. a Tangem card through WalletConnect) and waits for the
 * receipt. `onSent(hash)` is called once the wallet has signed and broadcast the transaction.
 */
export async function deploy({ bytecode, args, gas, onSent }) {
  const current = account();
  if (!current.address) throw new Error("Connect your wallet first.");
  if (current.chainId !== chainId) await switchChain(config, { chainId });
  // An explicit gas limit spares the wallet from estimating a contract creation, which some mobile wallets fail at.
  const hash = await deployContract(config, { abi, bytecode, args, chainId, gas });
  onSent?.(hash);
  return waitForTransactionReceipt(config, { hash });
}

/** Calldata of a call, for multisig wallets (e.g. Safe transaction builder). */
export const calldata = (functionName, args = []) => encodeFunctionData({ abi, functionName, args });
