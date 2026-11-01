// Hashrate benchmark: node bench.js
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { availableParallelism } from "node:os";
import { keccak_256 } from "@noble/hashes/sha3";
import { createKeccak } from "hash-wasm";
import { createSearch, encodeMessage } from "./src/pow.js";

const params = {
  seed: "0x9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  month: 1n, recipient: "0x1234567890abcdef1234567890abcdef12345678",
};

async function runMidstate(seconds, prefix = 0n) {
  const search = await createSearch({ ...params, target: 0n, prefix });
  const end = performance.now() + seconds * 1000;
  let n = 0n;
  while (performance.now() < end) { search.tryRange(n, 200_000); n += 200_000n; }
  return Number(n) / seconds;
}

if (!isMainThread) {
  parentPort.postMessage(await runMidstate(workerData.seconds, BigInt(workerData.id)));
} else {
  const fmt = (r) => (r / 1e6).toFixed(2) + " MH/s";
  await runMidstate(1); // warm-up
  console.log("1 thread, pow.js (wasm):         ", fmt(await runMidstate(4)));

  let n = 0, end = performance.now() + 3000;
  while (performance.now() < end) { for (let i = 0; i < 10000; i++) keccak_256(encodeMessage({ ...params, nonce: BigInt(n + i) })); n += 10000; }
  console.log("1 thread, noble keccak_256 full: ", fmt(n / 3));

  const h = await createKeccak(256);
  const msg = encodeMessage({ ...params, nonce: 0n });
  n = 0; end = performance.now() + 3000;
  while (performance.now() < end) { for (let i = 0; i < 10000; i++) { msg[159] = i & 255; h.init(); h.update(msg); h.digest("binary"); } n += 10000; }
  console.log("1 thread, hash-wasm keccak full: ", fmt(n / 3));

  for (const threads of [2, 4, availableParallelism()]) {
    const rates = await Promise.all(Array.from({ length: threads }, (_, id) => new Promise((ok) =>
      new Worker(new URL(import.meta.url), { workerData: { seconds: 4, id } }).on("message", ok))));
    console.log(`${threads} threads, pow.js (wasm):       `, fmt(rates.reduce((a, b) => a + b, 0)));
  }
}
