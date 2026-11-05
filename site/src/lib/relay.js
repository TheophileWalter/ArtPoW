// Client of the ArtPoW relay, which sends a mined proof and pays its gas (private repository artpow-relay). The relay
// can only mint to the recipient in the proof. Submitting a proof twice is harmless: it answers with the same request.

export class RelayError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(url, options, fetchFn) {
  let answer;
  try {
    answer = await fetchFn(url, options);
  } catch {
    throw new RelayError("relay_unavailable");
  }
  const body = await answer.json().catch(() => ({}));
  if (!answer.ok) throw new RelayError(body.error ?? "relay_unavailable");
  return body;
}

export const submitClaim = (baseUrl, { month, recipient, nonce }, fetchFn = fetch) =>
  call(`${baseUrl}/relay`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ month: Number(month), recipient, nonce: nonce.toString() }),
  }, fetchFn);

/** Asks for a month's artist or team proof (edition: "artist" or "team"). Only the contract chooses its recipient. */
export const submitProofRequest = (baseUrl, { month, edition }, fetchFn = fetch) =>
  call(`${baseUrl}/relay`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ month: Number(month), edition }),
  }, fetchFn);

/** Resolves to the transaction hash once mined. A failed poll is not an outcome: the request lives on in the relay. */
export async function waitForClaim(baseUrl, id, { onSent, fetchFn = fetch, pollMs = 3000, timeoutMs = 300_000, wait = sleep } = {}) {
  let announced;
  for (let waited = 0; waited < timeoutMs; waited += pollMs) {
    let request = null;
    try {
      request = await call(`${baseUrl}/relay/${id}`, {}, fetchFn);
    } catch (err) {
      if (err.code === "not_found") throw err;
    }
    if (request?.status === "mined") return request.txHash;
    if (request?.status === "failed") throw new RelayError(request.error ?? "relay_error");
    if (request?.status === "already_claimed") throw new RelayError("already_claimed");
    if (request?.txHash && request.txHash !== announced) onSent?.((announced = request.txHash));
    await wait(pollMs);
  }
  throw new RelayError("timeout");
}
