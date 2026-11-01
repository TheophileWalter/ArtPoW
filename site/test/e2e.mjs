// End-to-end check of the site's logic against a local Anvil node, with the production difficulty floor.
// Deploys the contract, checks the scheduling validation against the contract, mines a real proof with the
// WebAssembly miner, claims, mints a proof and reads everything back through the site's own modules.
// Run: npm run e2e (requires `forge build` and Foundry's anvil).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { createSearch } from "../../miner/src/pow.js";

if (!isMainThread) {
  // Mining thread: own random nonce space, reports the first hash below the target.
  const search = await createSearch({ ...workerData, month: BigInt(workerData.month), target: BigInt(workerData.target), prefix: BigInt(workerData.prefix) });
  for (let counter = 0n; ; counter += 1n << 20n) {
    const res = search.tryRange(counter, 1 << 20);
    if (res.found) {
      parentPort.postMessage({ nonce: res.nonce.toString(), hash: res.hash.toString() });
      break;
    }
  }
} else {
  await main();
}

async function main() {
  const { createTestClient, createWalletClient, http } = await import("viem");
  const { foundry } = await import("viem/chains");
  const PORT = 8561;
  const RPC = `http://127.0.0.1:${PORT}`;
  const anvil = spawn(`${homedir()}/.foundry/bin/anvil`, ["--port", String(PORT), "--silent"], { stdio: "ignore" });
  const step = (msg) => console.log(`✓ ${msg}`);

  try {
    await new Promise((r) => setTimeout(r, 1500));
    const testClient = createTestClient({ chain: foundry, mode: "anvil", transport: http(RPC) });
    const wallet = createWalletClient({ chain: foundry, transport: http(RPC) });
    const [admin, claimer, recipient, team] = await wallet.getAddresses();
    await testClient.mine({ blocks: 5 });

    // The site reads its configuration once, at import: predict the contract address (deployer + nonce) and point
    // the site at it before loading any of its modules.
    const { createPublicClient, getContractAddress } = await import("viem");
    const pc = createPublicClient({ chain: foundry, transport: http(RPC) });
    const predicted = getContractAddress({ from: admin, nonce: BigInt(await pc.getTransactionCount({ address: admin })) });
    Object.assign(process.env, { VITE_CHAIN_ID: "31337", VITE_CONTRACT: predicted, VITE_RPC_URL: RPC });

    // Deploy exactly as the deployment page does: same validation, same transaction data.
    const d = await import("../src/lib/deployment.js");
    const values = { name: "E2E Collection", symbol: "E2E", description: "End-to-end test", team };
    assert.deepEqual(d.validateDeployment(values), []);
    const deployHash = await wallet.sendTransaction({ account: admin, data: d.deployData(values) });
    const { contractAddress: address } = await pc.waitForTransactionReceipt({ hash: deployHash });
    assert.equal(address.toLowerCase(), predicted.toLowerCase());
    // The creation data is the compiler's bytecode followed by the constructor arguments used for verification.
    const tx = await pc.getTransaction({ hash: deployHash });
    const artifact = JSON.parse(readFileSync(new URL("../../out/ArtPoW.sol/ArtPoW.json", import.meta.url)));
    assert.equal(tx.input, artifact.bytecode.object + d.encodedConstructorArgs(values).slice(2));
    const c = await import("../src/lib/contract.js");
    const u = await import("../src/lib/util.js");
    step(`deployed with the deployment page's data at ${address}`);

    const send = async (functionName, args, account = admin) => {
      const hash = await wallet.writeContract({ address, abi: c.abi, functionName, args, account });
      const receipt = await pc.waitForTransactionReceipt({ hash });
      assert.equal(receipt.status, "success", functionName);
      return receipt;
    };
    const contractAccepts = (args) =>
      pc.simulateContract({ address, abi: c.abi, functionName: "scheduleMonth", args, account: admin }).then(() => true, () => false);

    // Scheduling validation of the admin page agrees with the contract.
    const now = Number((await pc.getBlock()).timestamp);
    const content = { label: "November 2026", artist: "Jane Doe", artistAddress: recipient, image: "ipfs://bafyexample", animationUrl: "" };
    const cases = [
      { month: 1, start: now + 60, end: now + 60 + 30 * u.DAY, content },
      { month: 1, start: now + 60, end: now + 60 + 24 * u.DAY, content },
      { month: 1, start: now - 10, end: now + 30 * u.DAY, content },
      { month: 2, start: now + 60, end: now + 60 + 30 * u.DAY, content },
      { month: 1, start: now + 60, end: now + 60 + 30 * u.DAY, content: { ...content, image: "" } },
      { month: 1, start: now + 60, end: now + 60 + 30 * u.DAY, content: { ...content, label: 'Nov "26' } },
    ];
    for (const v of cases) {
      const siteSaysValid = u.validateSchedule(v, [], now).length === 0;
      const contractSaysValid = await contractAccepts([BigInt(v.month), BigInt(v.start), BigInt(v.end), v.content]);
      assert.equal(siteSaysValid, contractSaysValid, JSON.stringify({ ...v, content: undefined }));
    }
    step("admin-page validation agrees with the contract on 6 cases");

    const valid = cases[0];
    await send("scheduleMonth", [1n, BigInt(valid.start), BigInt(valid.end), valid.content]);
    await testClient.increaseTime({ seconds: 61 });
    await testClient.mine({ blocks: 1 });
    assert.equal(Number(await c.read("activeMonth")), 1);
    const months = await c.getAllMonths();
    assert.equal(months[0].status, "active");
    step("month 1 scheduled and active");

    // Mining exactly as the mining page does: seed, current target, margin of two claims.
    const seed = await c.read("monthSeed", [1n]);
    const target = await c.read("currentTarget", [1n]);
    assert.equal(target, 1n << 228n);
    const aim = c.aimTarget(target, 2);
    const started = Date.now();
    const threads = 4;
    const workers = [];
    const found = await new Promise((resolve) => {
      for (let i = 0; i < threads; i++) {
        const w = new Worker(new URL(import.meta.url), {
          workerData: { seed, month: "1", recipient, target: aim.toString(), prefix: String(BigInt(i + 1) * 0x9e3779b97f4a7c15n % (1n << 64n)) },
        });
        w.on("message", resolve);
        workers.push(w);
      }
    });
    await Promise.all(workers.map((w) => w.terminate()));
    const nonce = BigInt(found.nonce);
    const hash = BigInt(found.hash);
    assert.ok(hash < aim);
    step(`proof mined in ${((Date.now() - started) / 1000).toFixed(1)} s on ${threads} threads (${c.leadingZeroBits(hash)} leading zero bits)`);

    // Claim sent by a third party, for the recipient.
    const receipt = await send("claim", [1n, recipient, nonce], claimer);
    const ev = c.findMintEvent(receipt);
    assert.equal(ev.eventName, "Claimed");
    assert.equal(ev.args.recipient, recipient);
    const token = await c.getToken(Number(ev.args.tokenId));
    assert.equal(token.owner, recipient);
    assert.equal(token.metadata.name, "November 2026 • #1");
    assert.equal(token.metadata.attributes.find((a) => a.trait_type === "Edition").value, "Mined");
    assert.ok(token.metadata.attributes.find((a) => a.trait_type === "Leading zero bits").value >= 28);
    step(`claimed by a third party: token #${ev.args.tokenId} "${token.metadata.name}" owned by the recipient`);

    // Team proof, triggered by anyone.
    const proofReceipt = await send("claimReserved", [1n, c.Edition.TeamProof], claimer);
    const proofEvent = c.findMintEvent(proofReceipt);
    assert.equal(proofEvent.eventName, "ProofClaimed");
    const proof = await c.getToken(Number(proofEvent.args.tokenId));
    assert.equal(proof.owner, team);
    assert.equal(proof.metadata.name, "November 2026 • Team proof");
    step("team proof minted to the team address");

    // Gallery and admin reads.
    assert.deepEqual(await c.getTokensOf(recipient), [1]);
    assert.deepEqual(await c.getTokensOf(team, () => {}, 1), [2]); // several batches
    const overview = await c.getOverview();
    assert.equal(overview.totalMinted, 2n);
    assert.deepEqual(await c.getAdmins(), [admin]);
    step("gallery (tokens of an address) and admin overview read correctly");
    console.log("\nEnd-to-end: all checks passed.");
  } finally {
    anvil.kill();
  }
}
