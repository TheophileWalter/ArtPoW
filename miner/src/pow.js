// Proof-of-work search for ArtPoW, usable in Node and in browser Web Workers.
//
// Hashed message: abi.encode(seed, month, recipient, nonce) = 4 words = 128 bytes, a single Keccak-256 block
// (rate 136). Each attempt XORs a counter into the padded block and runs one Keccak-f permutation in WebAssembly.
//
// Nonce layout (uint256, big-endian): [ prefix: 64 bits | extra: 128 bits | counter: 64 bits ].
// Parallel workers must use distinct (prefix, extra) pairs.

import { KECCAK_WASM_BASE64 } from "./keccak-wasm.js";

const RATE = 136;
const MSG_LEN = 128;
const MASK64 = (1n << 64n) - 1n;

function word(value) {
  let v = BigInt(value);
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function bytesToBigInt(bytes) {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

function bswap64(x) {
  let out = 0n;
  for (let i = 0; i < 8; i++) {
    out = (out << 8n) | ((x >> BigInt(8 * i)) & 0xffn);
  }
  return out;
}

/** abi.encode(seed, month, recipient, nonce) */
export function encodeMessage({ seed, month, recipient, nonce }) {
  const msg = new Uint8Array(MSG_LEN);
  msg.set(word(BigInt(seed)), 0);
  msg.set(word(month), 32);
  msg.set(word(BigInt(recipient)), 64);
  msg.set(word(nonce), 96);
  return msg;
}

export function composeNonce(prefix, extra, counter) {
  return (BigInt(prefix) << 192n) | (BigInt(extra) << 64n) | BigInt(counter);
}

/** Number of leading zero bits of a 256-bit hash. */
export function leadingZeroBits(hash) {
  return hash === 0n ? 256 : 256 - hash.toString(2).length;
}

let wasmModule;
async function loadWasm() {
  if (!wasmModule) {
    const bytes = Uint8Array.from(atob(KECCAK_WASM_BASE64), (c) => c.charCodeAt(0));
    wasmModule = await WebAssembly.compile(bytes);
  }
  return (await WebAssembly.instantiate(wasmModule)).exports;
}

/**
 * Prepares a search. Returns { tryRange(from, count) }, which tests counters [from, from + count) and
 * resolves to { found: true, nonce, hash, tried } or { found: false, tried: count }.
 */
export async function createSearch({ seed, month, recipient, target, prefix = 0n, extra = 0n }) {
  // Initial state: the message (counter bytes zero) followed by the Keccak padding, in a single block.
  const state = new Uint8Array(200);
  state.set(encodeMessage({ seed, month, recipient, nonce: composeNonce(prefix, extra, 0n) }), 0);
  state[MSG_LEN] ^= 0x01;
  state[RATE - 1] ^= 0x80;

  const wasm = await loadWasm();
  const memory = new Uint8Array(wasm.memory.buffer);
  memory.set(state, 0);

  const targetBig = BigInt(target);
  const targetTop = targetBig >> 192n;
  const toSigned = (x) => BigInt.asIntN(64, x);

  function tryRange(from, count) {
    let start = BigInt(from);
    let tried = 0;
    while (tried < count) {
      const i = wasm.search(toSigned(start), count - tried, toSigned(targetTop));
      if (i < 0) break;
      // The counter is XORed into the state as a little-endian lane: message bytes 120..128.
      const counter = (start + BigInt(i)) & MASK64;
      const hash = bytesToBigInt(memory.subarray(512, 544));
      tried += i + 1;
      if (hash < targetBig) {
        return { found: true, nonce: composeNonce(prefix, extra, bswap64(counter)), hash, tried };
      }
      start = counter + 1n;
    }
    return { found: false, tried: count };
  }

  return { tryRange };
}
