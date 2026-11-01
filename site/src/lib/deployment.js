// Contract deployment helpers: validation, deployment data and source verification. No DOM, no wallet.
import { encodeAbiParameters, encodeDeployData, getAddress, isAddress, zeroAddress } from "viem";
import abi from "./abi.json" with { type: "json" };
import artifact from "./bytecode.json" with { type: "json" };
import { isJsonSafe } from "./util.js";

export const bytecode = artifact.bytecode;

export const DEFAULTS = {
  name: "ArtPoW",
  symbol: "ARTPOW",
  description:
    "A new artwork every month, mined, not bought. A free NFT earned by proof of work and claimed on-chain: the difficulty targets about 1,000 editions per month.",
  team: "",
};

/** Problems that would make the deployment revert or leave an unusable collection (empty when valid). */
export function validateDeployment({ name, symbol, description, team }) {
  const problems = [];
  if (!name.trim()) problems.push("The name is required.");
  if (!symbol.trim()) problems.push("The symbol is required.");
  if (!description.trim()) problems.push("The description is required.");
  if (name !== name.trim() || symbol !== symbol.trim() || description !== description.trim()) {
    problems.push("Remove leading or trailing spaces: they would be part of the permanent values.");
  }
  if (!isJsonSafe(name)) problems.push("Name: double quotes, backslashes and control characters are not allowed.");
  if (!isJsonSafe(description)) problems.push("Description: double quotes, backslashes and control characters are not allowed.");
  if (team.trim() && !isAddress(team.trim())) problems.push("The team address is not a valid address (leave it empty for none).");
  return problems;
}

/** Constructor arguments, in order. */
export const constructorArgs = ({ name, symbol, description, team }) => [
  name,
  symbol,
  description,
  team.trim() ? getAddress(team.trim()) : zeroAddress,
];

/** Transaction data creating the contract (bytecode followed by the encoded constructor arguments). */
export const deployData = (values) => encodeDeployData({ abi, bytecode, args: constructorArgs(values) });

/** ABI-encoded constructor arguments, as Polygonscan and `forge verify-contract` expect them. */
export const encodedConstructorArgs = (values) =>
  encodeAbiParameters(
    [{ type: "string" }, { type: "string" }, { type: "string" }, { type: "address" }],
    constructorArgs(values),
  );

/** Command verifying the source code on the block explorer (run at the repository root, ETHERSCAN_API_KEY set). */
export const verifyCommand = (address, values, chainId) =>
  `forge verify-contract ${address} src/ArtPoW.sol:ArtPoW --chain ${chainId} --constructor-args ${encodedConstructorArgs(values)} --watch`;
