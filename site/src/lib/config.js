// Site configuration, read from Vite environment variables (see .env.example).
import { foundry, polygon, polygonAmoy } from "viem/chains";

const env = (typeof import.meta !== "undefined" && import.meta.env) || {};
const read = (key, fallback = "") => (typeof process !== "undefined" && process.env?.[key]) || env[key] || fallback;

const CHAINS = { 137: polygon, 80002: polygonAmoy, 31337: foundry };
// viem's default public endpoints (polygon-rpc.com, rpc-amoy.polygon.technology) no longer answer without a key.
const DEFAULT_RPC = {
  137: "https://polygon-bor-rpc.publicnode.com",
  80002: "https://polygon-amoy-bor-rpc.publicnode.com",
};

export const chainId = Number(read("VITE_CHAIN_ID", "80002"));
export const chain = CHAINS[chainId];
if (!chain) throw new Error(`Unsupported VITE_CHAIN_ID ${chainId}`);

export const contractAddress = read("VITE_CONTRACT", "0x0000000000000000000000000000000000000000");
export const rpcUrl = read("VITE_RPC_URL") || DEFAULT_RPC[chainId] || chain.rpcUrls.default.http[0];
export const deployBlock = BigInt(read("VITE_DEPLOY_BLOCK", "0") || "0");
export const walletConnectProjectId = read("VITE_WALLETCONNECT_PROJECT_ID");
export const ipfsGateway = read("VITE_IPFS_GATEWAY", "https://ipfs.io/ipfs/");
export const arweaveGateway = read("VITE_ARWEAVE_GATEWAY", "https://arweave.net/");
export const explorer = chain.blockExplorers?.default?.url ?? "";
/** ArtPoW relay, which sends claims and pays their gas. Without one, the mining page only offers the wallet. */
const DEFAULT_RELAY = { 137: "https://fjm7k26s3i.execute-api.eu-west-3.amazonaws.com" };
export const relayUrl = read("VITE_RELAY_URL") || DEFAULT_RELAY[chainId] || "";
/** Public repository of the project, linked from the footer. */
export const sourceUrl = read("VITE_SOURCE_URL", "https://github.com/TheophileWalter/ArtPoW");

/** Miners aim at the target the contract would have after this many more claims (≈ 7% harder each). */
export const MINING_MARGIN_CLAIMS = 2;
/** Hash rate assumed for an average browser, used for estimates only. */
export const TYPICAL_BROWSER_HASHRATE = 4e6;
