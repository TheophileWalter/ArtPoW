// Web Worker: searches nonces with the WebAssembly miner over its own nonce space (prefix, extra).
import { createSearch } from "@miner/pow.js";

const CHUNK = 1 << 18; // ~0.1 s per batch: keeps progress reports and target updates responsive
let params = null;
let search = null;
let counter = 0n;
let running = false;

async function prepare() {
  search = await createSearch({
    seed: params.seed,
    month: BigInt(params.month),
    recipient: params.recipient,
    target: BigInt(params.target),
    prefix: BigInt(params.prefix),
    extra: BigInt(params.extra),
  });
}

async function loop() {
  while (running) {
    const res = search.tryRange(counter, CHUNK);
    counter += BigInt(res.tried);
    postMessage({ type: "progress", tried: res.tried });
    if (res.found) postMessage({ type: "found", nonce: res.nonce.toString(), hash: res.hash.toString() });
    await new Promise((resolve) => setTimeout(resolve, 0)); // let messages (target, stop) through
  }
}

onmessage = async ({ data }) => {
  if (data.type === "start") {
    params = data.params;
    counter = 0n;
    await prepare();
    running = true;
    loop();
  } else if (data.type === "target") {
    params = { ...params, target: data.target };
    await prepare(); // same nonce space, new target; the counter keeps going
  } else if (data.type === "stop") {
    running = false;
  }
};
