import assert from "node:assert/strict";
import { test } from "node:test";
import { RelayError, submitClaim, submitProofRequest, waitForClaim } from "../src/lib/relay.js";

const answer = (status, body) => ({ ok: status < 400, status, json: async () => body });
const wait = async () => {};
const code = (expected) => (err) => err instanceof RelayError && err.code === expected;

test("a proof is posted with its nonce as a string", async () => {
  let sent;
  const fetchFn = async (url, options) => {
    sent = { url, body: JSON.parse(options.body) };
    return answer(202, { id: "1-0xabc", status: "queued" });
  };
  const request = await submitClaim("https://relay", { month: 2, recipient: "0xabc", nonce: 2n ** 200n }, fetchFn);
  assert.equal(request.id, "1-0xabc");
  assert.equal(sent.url, "https://relay/relay");
  assert.deepEqual(sent.body, { month: 2, recipient: "0xabc", nonce: (2n ** 200n).toString() });
});

test("a proof request names only the month and the edition", async () => {
  let sent;
  const fetchFn = async (url, options) => {
    sent = { url, body: JSON.parse(options.body) };
    return answer(202, { id: "2-proof-team", status: "queued" });
  };
  const request = await submitProofRequest("https://relay", { month: 2n, edition: "team" }, fetchFn);
  assert.equal(request.id, "2-proof-team");
  assert.equal(sent.url, "https://relay/relay");
  assert.deepEqual(sent.body, { month: 2, edition: "team" });
});

test("refusals and outages become relay errors", async () => {
  await assert.rejects(submitClaim("r", { month: 1, recipient: "a", nonce: 1n }, async () => answer(422, { error: "proof_outdated" })), code("proof_outdated"));
  await assert.rejects(submitClaim("r", { month: 1, recipient: "a", nonce: 1n }, async () => answer(503, {})), code("relay_unavailable"));
  await assert.rejects(submitClaim("r", { month: 1, recipient: "a", nonce: 1n }, async () => { throw new TypeError("network"); }), code("relay_unavailable"));
});

test("waiting follows the request to its transaction, through a failed poll", async () => {
  const answers = [
    () => answer(200, { status: "queued" }),
    () => { throw new TypeError("network"); },
    () => answer(200, { status: "sent", txHash: "0x1" }),
    () => answer(200, { status: "sent", txHash: "0x1" }),
    () => answer(200, { status: "sent", txHash: "0x2" }),
    () => answer(200, { status: "mined", txHash: "0x2" }),
  ];
  const sent = [];
  const hash = await waitForClaim("r", "id", { fetchFn: async () => answers.shift()(), wait, onSent: (h) => sent.push(h) });
  assert.equal(hash, "0x2");
  assert.deepEqual(sent, ["0x1", "0x2"]);
});

test("waiting ends on a failure, a claim made elsewhere, or the timeout", async () => {
  await assert.rejects(waitForClaim("r", "id", { wait, fetchFn: async () => answer(200, { status: "failed", error: "relay_empty" }) }), code("relay_empty"));
  await assert.rejects(waitForClaim("r", "id", { wait, fetchFn: async () => answer(200, { status: "already_claimed" }) }), code("already_claimed"));
  await assert.rejects(waitForClaim("r", "id", { wait, fetchFn: async () => answer(404, { error: "not_found" }) }), code("not_found"));
  await assert.rejects(waitForClaim("r", "id", { wait, pollMs: 1, timeoutMs: 3, fetchFn: async () => answer(200, { status: "queued" }) }), code("timeout"));
});
