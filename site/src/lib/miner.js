// Runs the proof-of-work search on several Web Workers and reports progress.
import { expectedHashes } from "./contract.js";

const random64 = () => {
  const words = crypto.getRandomValues(new Uint32Array(2));
  return (BigInt(words[0]) << 32n) | BigInt(words[1]);
};

export class Miner {
  /** `onProgress({ hashrate, tried, expected })`, `onFound({ nonce, hash })`. */
  constructor({ onProgress, onFound }) {
    this.onProgress = onProgress;
    this.onFound = onFound;
    this.workers = [];
  }

  static defaultThreads() {
    const cores = navigator.hardwareConcurrency || 4;
    return Math.max(1, Math.min(8, cores - 1));
  }

  start({ seed, month, recipient, target, threads = Miner.defaultThreads() }) {
    this.stop();
    this.tried = 0;
    this.startedAt = performance.now();
    this.target = target;
    for (let i = 0; i < threads; i++) {
      const worker = new Worker(new URL("./mine-worker.js", import.meta.url), { type: "module" });
      worker.onmessage = ({ data }) => this.#onMessage(data);
      // Distinct random nonce spaces: workers (and other tabs or devices) never repeat each other's work.
      const params = { seed, month: month.toString(), recipient, target: target.toString(), prefix: random64().toString(), extra: random64().toString() };
      worker.postMessage({ type: "start", params });
      this.workers.push(worker);
    }
  }

  setTarget(target) {
    this.target = target;
    for (const w of this.workers) w.postMessage({ type: "target", target: target.toString() });
  }

  stop() {
    for (const w of this.workers) {
      w.postMessage({ type: "stop" });
      w.terminate();
    }
    this.workers = [];
  }

  get running() {
    return this.workers.length > 0;
  }

  #onMessage(data) {
    if (data.type === "progress") {
      this.tried += data.tried;
      const seconds = (performance.now() - this.startedAt) / 1000;
      this.onProgress?.({ hashrate: this.tried / seconds, tried: this.tried, expected: expectedHashes(this.target) });
    } else if (data.type === "found") {
      this.onFound?.({ nonce: BigInt(data.nonce), hash: BigInt(data.hash) });
    }
  }
}
