import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// Deliberately fixed to a synthetic fixture and the demo Worker; no expected data goes to the model.
const root = new URL("../../../", import.meta.url);
const token = readFileSync(new URL(".env.extraction-probe", root), "utf8").trim();
const bytes = readFileSync(new URL("fixtures/invoices/001.png", root));
const expected = JSON.parse(readFileSync(new URL("fixtures/scenarios/invoices.json", root), "utf8")).cases[0].expectedExtraction;
const base = "https://oli-api.tiamat-agency.workers.dev";
assert.equal((await fetch(base + "/api/health")).status, 200);
assert.equal((await fetch(base + "/api/internal/extraction-probe", { method: "POST" })).status, 401);
const started = Date.now();
const response = await fetch(base + "/api/internal/extraction-probe", {
  method: "POST", signal: AbortSignal.timeout(45000),
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/png" }, body: bytes,
});
const payload = await response.json();
if (!response.ok) {
  console.error(JSON.stringify({ status: response.status, ...payload }));
  process.exitCode = 1;
} else {
  const { data } = payload;
  assert.equal(data.documentSha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(data.verification, "NOT_CHECKED");
  assert.equal("action" in data, false);
  const fields = ["vendorName", "invoiceNumber", "amountMinor", "currency", "issuedAt", "dueDate", "servicePeriod", "description"];
  const matchingFields = fields.filter((field) => data.extraction[field] === expected[field]);
  console.log(JSON.stringify({ at: new Date().toISOString(), fixture: "001.png", durationMs: Date.now() - started,
    model: data.model, provider: data.provider, usage: data.usage, attempts: data.attempts,
    matchingFields, fieldCount: fields.length, warnings: data.extraction.extractionWarnings,
    verification: data.verification }, null, 2));
  assert.deepEqual(matchingFields, fields, "synthetic fixture extraction mismatch");
}
