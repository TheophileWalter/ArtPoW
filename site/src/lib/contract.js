// Read access to ArtPoW, independent of any wallet. Pure logic: usable in the browser and in Node tests.
import { createPublicClient, decodeEventLog, http } from "viem";
import abi from "./abi.json" with { type: "json" };
import { chain, contractAddress, rpcUrl } from "./config.js";

export { abi };
export const ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";
export const Edition = { Mined: 0, ArtistProof: 1, TeamProof: 2 };
export const TWO_256 = 1n << 256n;

export const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const nft = { address: contractAddress, abi };

export const read = (functionName, args = []) => publicClient.readContract({ ...nft, functionName, args });

/** Time of the latest block: the contract's clock, which the visitor's computer clock may not match. */
export const chainNow = async () => (await publicClient.getBlock()).timestamp;

/** Month data with its number and a status ("upcoming", "active" or "closed"), judged by the chain's clock. */
export async function getMonth(month, now) {
  const [[start, end, minted, closed, content], time] = await Promise.all([
    read("getMonth", [BigInt(month)]),
    now ?? chainNow(),
  ]);
  const status = closed ? "closed" : time < start ? "upcoming" : "active";
  return { month: Number(month), start, end, minted, closed, content, status };
}

export async function getAllMonths() {
  const [count, now] = await Promise.all([read("monthCount").then(Number), chainNow()]);
  return Promise.all(Array.from({ length: count }, (_, i) => getMonth(i + 1, now)));
}

/** Overview of the collection, for the home page and the administration page. */
export async function getOverview() {
  const [name, monthCount, activeMonth, totalMinted, isShutDown, owner, teamRecipient, siteUrl, collectionImage] =
    await Promise.all(
      ["name", "monthCount", "activeMonth", "totalMinted", "isShutDown", "owner", "teamRecipient", "siteUrl",
        "collectionImage"].map((f) => read(f)),
    );
  return { name, monthCount, activeMonth, totalMinted, isShutDown, owner, teamRecipient, siteUrl, collectionImage };
}

// One call: a count then indexed reads could reach two load-balanced RPC nodes a block apart and go out of range.
export const getAdmins = () => read("getRoleMembers", [ADMIN_ROLE]).then((admins) => [...admins]);

/** Decoded on-chain JSON metadata of a token. */
export async function getToken(tokenId) {
  const [uri, owner] = await Promise.all([read("tokenURI", [BigInt(tokenId)]), read("ownerOf", [BigInt(tokenId)])]);
  return { tokenId: Number(tokenId), owner, metadata: decodeDataJson(uri) };
}

export function decodeDataJson(uri) {
  const prefix = "data:application/json;base64,";
  if (!uri.startsWith(prefix)) throw new Error("Unexpected token URI");
  const bytes = Uint8Array.from(atob(uri.slice(prefix.length)), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/**
 * Tokens currently owned by `account`. Token ids run from 1 to totalMinted, so the owner of every token is read in
 * batches (one Multicall3 call per batch where the chain has it). Unlike scanning Transfer logs, this does not
 * depend on the RPC's block-range limit (10,000 blocks on public Polygon endpoints) and grows with the number of
 * tokens, not with the age of the contract.
 */
export async function getTokensOf(account, onProgress = () => {}, batch = 500) {
  const total = Number(await read("totalMinted"));
  const owned = [];
  const target = account.toLowerCase();
  for (let first = 1; first <= total; first += batch) {
    const ids = Array.from({ length: Math.min(batch, total - first + 1) }, (_, i) => BigInt(first + i));
    const owners = publicClient.chain.contracts?.multicall3
      ? (await publicClient.multicall({ contracts: ids.map((id) => ({ ...nft, functionName: "ownerOf", args: [id] })), allowFailure: true })).map((r) => r.result)
      : await Promise.all(ids.map((id) => read("ownerOf", [id]).catch(() => undefined)));
    owners.forEach((owner, i) => owner?.toLowerCase() === target && owned.push(Number(ids[i])));
    onProgress(first + ids.length - 1, total);
  }
  return owned;
}

/** tokenData of several tokens (month, number, edition…), in one Multicall3 call per batch where available. */
export async function getTokensData(ids, batch = 500) {
  const out = [];
  for (let i = 0; i < ids.length; i += batch) {
    const part = ids.slice(i, i + batch).map(BigInt);
    out.push(...(publicClient.chain.contracts?.multicall3
      ? (await publicClient.multicall({ contracts: part.map((id) => ({ ...nft, functionName: "tokenData", args: [id] })), allowFailure: false }))
      : await Promise.all(part.map((id) => read("tokenData", [id])))));
  }
  return out;
}

/** Expected number of hashes for a target, as a Number (fine for display). */
export const expectedHashes = (target) => Number(TWO_256 / (target > 0n ? target : 1n));

/**
 * Target to aim at when mining: the target the contract would have after `margin` more claims, i.e.
 * target * 2^(-margin/10). Computed in fixed point; slightly conservative.
 */
export function aimTarget(target, margin) {
  const factor = Math.pow(2, -margin / 10);
  return (target * BigInt(Math.floor(factor * 1e9))) / 1_000_000_000n;
}

/** Leading zero bits of a 256-bit hash. */
export const leadingZeroBits = (hash) => (hash === 0n ? 256 : 256 - hash.toString(2).length);

/** Finds the Claimed or ProofClaimed event of a transaction receipt. */
export function findMintEvent(receipt) {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== contractAddress.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi, data: log.data, topics: log.topics });
      if (ev.eventName === "Claimed" || ev.eventName === "ProofClaimed") return ev;
    } catch {
      // not one of ours
    }
  }
  return null;
}
