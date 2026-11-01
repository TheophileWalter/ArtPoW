import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { keccak_256 } from "@noble/hashes/sha3";
import { createSearch, encodeMessage, composeNonce } from "../src/pow.js";

const params = {
  seed: "0x9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  month: 3n,
  recipient: "0x1234567890abcdef1234567890abcdef12345678",
};
const big = (bytes) => BigInt("0x" + Buffer.from(bytes).toString("hex"));

test("search matches a plain keccak256 of abi.encode", async () => {
  const target = 1n << 244n; // ~4096 attempts
  const prefix = 0xdeadbeefn, extra = 0x0123456789abcdefn;
  const res = (await createSearch({ ...params, target, prefix, extra })).tryRange(0n, 1_000_000);
  assert.ok(res.found);
  const hash = big(keccak_256(encodeMessage({ ...params, nonce: res.nonce })));
  assert.equal(hash, res.hash);
  assert.ok(hash < target);
  assert.equal(res.nonce >> 192n, prefix);
});

test("counter carries across 32 bits", async () => {
  const target = 1n << 250n;
  const res = (await createSearch({ ...params, target })).tryRange(0xfffffff0n, 100_000);
  assert.ok(res.found);
  const hash = big(keccak_256(encodeMessage({ ...params, nonce: res.nonce })));
  assert.equal(hash, res.hash);
});

test("encoding matches Solidity abi.encode", () => {
  const nonce = composeNonce(1n, 2n, 3n);
  const encoded = execFileSync(process.env.HOME + "/.foundry/bin/cast", [
    "abi-encode", "f(bytes32,uint256,address,uint256)",
    params.seed, params.month.toString(), params.recipient, nonce.toString(),
  ]).toString().trim();
  assert.equal("0x" + Buffer.from(encodeMessage({ ...params, nonce })).toString("hex"), encoded);
});
