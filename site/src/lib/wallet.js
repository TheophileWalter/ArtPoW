// Wallet connection and transactions. With a WalletConnect (Reown) project id, the AppKit modal offers mobile
// wallets (QR code) and browser wallets; without one, the site falls back to the browser wallet only.
import { createAppKit } from "@reown/appkit";
import { foundry, polygon, polygonAmoy } from "@reown/appkit/networks";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import {
  connect as wagmiConnect,
  createConfig,
  deployContract,
  disconnect as wagmiDisconnect,
  getConnection,
  http,
  injected,
  simulateContract,
  switchChain,
  waitForTransactionReceipt,
  watchConnection,
  writeContract,
} from "@wagmi/core";
import { encodeFunctionData } from "viem";
import { abi } from "./contract.js";
import { t } from "./i18n.js";
import { chain, chainId, contractAddress, rpcUrl, walletConnectProjectId } from "./config.js";

const NETWORKS = { 137: polygon, 80002: polygonAmoy, 31337: foundry };
const network = NETWORKS[chainId];

let config;
let modal = null;

if (walletConnectProjectId) {
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
    features: { analytics: false, email: true, socials: false, swaps: false, onramp: false },
  });
} else {
  config = createConfig({ chains: [chain], connectors: [injected()], transports: { [chainId]: http(rpcUrl) } });
}

export const account = () => getConnection(config);
export const onAccountChange = (callback) => watchConnection(config, { onChange: callback });

export async function connect() {
  if (modal) return modal.open();
  if (!window.ethereum) throw new Error(t("wallet.noBrowserWallet"));
  return wagmiConnect(config, { connector: injected(), chainId });
}

/** Whether accounts by email are offered: they come with the AppKit modal. */
export const emailAccounts = () => Boolean(modal);

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
