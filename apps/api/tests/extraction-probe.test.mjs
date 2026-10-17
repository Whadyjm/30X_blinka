import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { handleExtractionProbe } from "../worker/extraction-probe.js";
import { ExtractionError } from "@oli/extraction";

const env = { EXTRACTION_PROBE_TOKEN: "synthetic-test-token", OPENROUTER_API_KEY: "test-only-key" };
const request = (body = new Uint8Array([137, 80]), headers = {}) => new Request("https://example.com/api/internal/extraction-probe", {
  method: "POST", body, headers: { Authorization: `Bearer ${env.EXTRACTION_PROBE_TOKEN}`, "Content-Type": "image/png", ...headers },
});
const neverExtract = async () => assert.fail("must not spend provider calls");

test("probe disabled or wrong credentials cannot call the extractor", async () => {
  assert.equal((await handleExtractionProbe(request(), {}, neverExtract)).status, 404);
  for (const Authorization of ["", "Bearer wrong", "Basic synthetic-test-token", "Bearer " + "x".repeat(600)]) {
    assert.equal((await handleExtractionProbe(request(undefined, { Authorization }), env, neverExtract)).status, 401);
  }
});

test("rejects unsupported formats and oversized declared or streamed images", async () => {
  assert.equal((await handleExtractionProbe(request(undefined, { "Content-Type": "application/pdf" }), env, neverExtract)).status, 415);
  assert.equal((await handleExtractionProbe(request(undefined, { "Content-Length": "5242881" }), env, neverExtract)).status, 413);
  assert.equal((await handleExtractionProbe(request(new Uint8Array(5242881)), env, neverExtract)).status, 413);
});

test("hashes actual bytes on server, returns unverified extraction and never touches D1", async () => {
  const bytes = new Uint8Array([137, 80, 78]);
  const response = await handleExtractionProbe(request(bytes), env, async (options) => {
    assert.equal(options.apiKey, env.OPENROUTER_API_KEY);
    assert.equal(options.documentSha256, createHash("sha256").update(bytes).digest("hex"));
    assert.deepEqual(options.images[0].bytes, bytes);
    return { model: "test-model", extraction: { amountMinor: null }, attempts: [] };
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const { data } = await response.json();
  assert.equal(data.verification, "NOT_CHECKED");
  assert.equal("action" in data, false);
});

test("provider failures expose only safe code and attempts", async () => {
  const response = await handleExtractionProbe(request(), env, async () => { throw new ExtractionError("ALL_MODELS_UNAVAILABLE"); });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: { code: "ALL_MODELS_UNAVAILABLE", attempts: [] } });
});
