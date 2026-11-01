// Local demo: starts Anvil, deploys the contract with sample content (an open month, an upcoming one, generated
// artworks, both proofs minted) and keeps the node running. Then, in another terminal:
//   VITE_CHAIN_ID=31337 VITE_CONTRACT=<printed address> VITE_RPC_URL=http://127.0.0.1:8545 npm run dev
// Requires `forge build` at the repository root and Foundry's anvil.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { createPublicClient, createTestClient, createWalletClient, http } from "viem";
import { foundry } from "viem/chains";

const PORT = Number(process.env.PORT || 8545);
const RPC = `http://127.0.0.1:${PORT}`;
const DAY = 86400;

/** Abstract square artwork as a data: URI (base64, so it is JSON-safe for the contract). */
function artwork(seed, hues) {
  let x = seed;
  const rand = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  const circles = Array.from({ length: 9 }, (_, i) => {
    const hue = hues[i % hues.length];
    return `<circle cx="${(rand() * 1000).toFixed(0)}" cy="${(rand() * 1000).toFixed(0)}" r="${(120 + rand() * 260).toFixed(0)}" fill="hsl(${hue} 90% 60% / .55)"/>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><defs><filter id="b"><feGaussianBlur stdDeviation="60"/></filter></defs><rect width="1000" height="1000" fill="#0b0d14"/><g filter="url(#b)">${circles}</g><g stroke="#ffffff22" fill="none">${Array.from({ length: 12 }, (_, i) => `<circle cx="500" cy="500" r="${40 + i * 36}"/>`).join("")}</g></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

const anvil = spawn(`${homedir()}/.foundry/bin/anvil`, ["--port", String(PORT), "--silent"], { stdio: "inherit" });
process.on("SIGINT", () => { anvil.kill(); process.exit(0); });
await new Promise((r) => setTimeout(r, 1500));

const pc = createPublicClient({ chain: foundry, transport: http(RPC) });
const wallet = createWalletClient({ chain: foundry, transport: http(RPC) });
const test = createTestClient({ chain: foundry, mode: "anvil", transport: http(RPC) });
const [admin, , team, artist] = await wallet.getAddresses();
await test.mine({ blocks: 5 });

const artifact = JSON.parse(readFileSync(new URL("../../out/ArtPoW.sol/ArtPoW.json", import.meta.url)));
const hash = await wallet.deployContract({
  account: admin,
  abi: artifact.abi,
  bytecode: artifact.bytecode.object,
  args: ["ArtPoW Demo", "ARTPOWD", "A free NFT every month, earned by proof of work.", team],
});
const { contractAddress: address } = await pc.waitForTransactionReceipt({ hash });
const send = async (functionName, args) => {
  const h = await wallet.writeContract({ address, abi: artifact.abi, functionName, args, account: admin });
  await pc.waitForTransactionReceipt({ hash: h });
};

const now = Number((await pc.getBlock()).timestamp);
const start = now + 60;
await send("scheduleMonth", [1n, BigInt(start), BigInt(start + 30 * DAY), {
  label: "November 2026", artist: "Ada Nakamura", artistAddress: artist, image: artwork(7, [265, 175, 320]), animationUrl: "",
}]);
await send("scheduleMonth", [2n, BigInt(start + 30 * DAY), BigInt(start + 61 * DAY), {
  label: "December 2026", artist: "Leo Varga", artistAddress: artist, image: artwork(42, [20, 45, 190]), animationUrl: "",
}]);
await send("setCollectionInfo", [artwork(3, [265, 175]), "http://localhost:5173"]);
await test.increaseTime({ seconds: 61 });
await test.mine({ blocks: 1 });
await send("claimReserved", [1n, 1]);
await send("claimReserved", [1n, 2]);

console.log(`\nDemo contract: ${address} (administrator: ${admin})`);
console.log(`Run the site with:\n  VITE_CHAIN_ID=31337 VITE_CONTRACT=${address} VITE_RPC_URL=${RPC} npm run dev`);
console.log("Import an Anvil account into your wallet to claim or administer. Ctrl-C to stop.");
