import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { ExtractedInvoiceSchema } from "../../../packages/contracts/src/index.ts";

// Paid evaluation is explicit, sequential and limited to the ten existing synthetic PNG variants.
assert.equal(process.argv[2], "--run", "Pass --run to spend OpenRouter calls on the synthetic PNG corpus");
const root = new URL("../../../", import.meta.url);
const manifestBytes = readFileSync(new URL("fixtures/scenarios/invoices.json", root));
const corpus = JSON.parse(manifestBytes);
const allFiles = corpus.cases.flatMap((scenario) => (scenario.variants ?? [])
  .filter((variant) => variant.mimeType === "image/png")
  .map((variant) => ({ scenario, variant })));
assert.equal(allFiles.length, 10);
const selection = process.argv[3]?.match(/^--cases=(case_\d{3}(?:,case_\d{3})*)$/)?.[1].split(",");
assert.ok(!process.argv[3] || selection, "Optional selection must be --cases=case_001,case_039");
assert.ok(!selection || selection.every((id) => allFiles.some(({ scenario }) => scenario.id === id)), "Only existing PNG cases can be selected");
const files = allFiles.filter(({ scenario }) => !selection || selection.includes(scenario.id));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
for (const { variant } of files) {
  assert.match(variant.path, /^invoices\/\d{3}\.png$/);
  assert.equal(sha256(readFileSync(new URL("fixtures/" + variant.path, root))), variant.sha256);
}
const token = readFileSync(new URL(".env.extraction-probe", root), "utf8").trim();
assert.ok(token.length >= 32);
const base = "https://oli-api.tiamat-agency.workers.dev";
assert.equal((await fetch(base + "/api/health", { signal: AbortSignal.timeout(10000) })).status, 200);
assert.equal((await fetch(base + "/api/internal/extraction-probe", {
  method: "POST", signal: AbortSignal.timeout(10000),
})).status, 401);
const fields = ["vendorName", "invoiceNumber", "amountMinor", "currency", "issuedAt", "dueDate", "servicePeriod", "description"];
const critical = ["vendorName", "amountMinor", "currency", "dueDate"];
const report = {
  startedAt: new Date().toISOString(), finishedAt: null, target: base, format: "PNG",
  datasetVersion: corpus.datasetVersion, manifestSha256: sha256(manifestBytes),
  localAdapterSha256: sha256(readFileSync(new URL("packages/extraction/src/openrouter.ts", root))),
  limits: { documents: files.length, maximumModelCalls: files.length * 3, retriesPerDocument: 0 },
  note: "Extraction only; no corroboration, decisions or D1 writes. Costs include only successful responses, not failed/interrupted attempts. Exact field comparison is intentionally strict.",
  results: [], summary: null,
};
const outputDir = new URL("docs/evaluations/", root);
mkdirSync(outputDir, { recursive: true });
const output = new URL("extraction-png-" + report.startedAt.replace(/[:.]/g, "-") + ".json", outputDir);
const save = () => {
  const serialized = JSON.stringify(report, null, 2) + "\n";
  assert.equal(serialized.includes(token), false);
  writeFileSync(output, serialized);
};
save();
for (const { scenario, variant } of files) {
  const started = Date.now();
  const row = { caseId: scenario.id, label: scenario.label, file: variant.path,
    documentSha256: variant.sha256, durationMs: null, status: null, success: false };
  try {
    // Expected fields and scenario metadata stay local; only image bytes reach the extractor.
    const response = await fetch(base + "/api/internal/extraction-probe", {
      method: "POST", signal: AbortSignal.timeout(45000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/png" },
      body: readFileSync(new URL("fixtures/" + variant.path, root)),
    });
    row.status = response.status;
    const payload = await response.json();
    if (!response.ok) {
      row.error = payload.error;
    } else {
      const { data } = payload;
      assert.equal(data.documentSha256, variant.sha256);
      assert.equal(data.verification, "NOT_CHECKED");
      assert.equal("action" in data, false);
      const extraction = ExtractedInvoiceSchema.parse(data.extraction);
      row.model = data.model;
      row.provider = data.provider;
      row.attempts = data.attempts;
      row.usage = data.usage;
      row.extraction = extraction;
      row.expectedExtraction = scenario.expectedExtraction;
      row.matchingFields = fields.filter((field) => extraction[field] === scenario.expectedExtraction[field]);
      row.mismatches = fields.filter((field) => !row.matchingFields.includes(field)).map((field) => ({
        field, expected: scenario.expectedExtraction[field], actual: extraction[field],
        conservativeAbstention: extraction[field] === null && scenario.expectedExtraction[field] !== null,
      }));
      row.criticalExact = critical.every((field) => row.matchingFields.includes(field));
      row.hasWarnings = extraction.extractionWarnings.length > 0;
      row.incompleteCriticalFields = critical.filter((field) => extraction[field] === null);
      row.success = true;
    }
  } catch (error) {
    row.error = { code: error instanceof Error && error.name === "TimeoutError" ? "CLIENT_TIMEOUT" : "EVALUATION_REQUEST_OR_VALIDATION_FAILED" };
  }
  row.durationMs = Date.now() - started;
  report.results.push(row);
  save();
  console.log(JSON.stringify({ completed: report.results.length, total: files.length, caseId: row.caseId,
    status: row.status, success: row.success, model: row.model, durationMs: row.durationMs,
    exactFields: row.matchingFields?.length, criticalExact: row.criticalExact,
    hasWarnings: row.hasWarnings, error: row.error?.code }));
}
const successful = report.results.filter((row) => row.success);
const durations = report.results.map((row) => row.durationMs).sort((a, b) => a - b);
report.finishedAt = new Date().toISOString();
report.summary = {
  attempted: report.results.length, successful: successful.length, failed: report.results.length - successful.length,
  allEightFieldsExact: successful.filter((row) => row.matchingFields.length === fields.length).length,
  criticalFieldsExact: successful.filter((row) => row.criticalExact).length,
  fieldMatches: Object.fromEntries(fields.map((field) => [field, {
    matched: successful.filter((row) => row.matchingFields.includes(field)).length,
    attempted: report.results.length, returned: successful.length,
  }])),
  withWarnings: successful.filter((row) => row.hasWarnings).length,
  withIncompleteCriticalFields: successful.filter((row) => row.incompleteCriticalFields.length > 0).length,
  successfulModels: Object.fromEntries([...new Set(successful.map((row) => row.model))]
    .map((model) => [model, successful.filter((row) => row.model === model).length])),
  medianDurationMs: durations.length % 2 ? durations[Math.floor(durations.length / 2)]
    : (durations[durations.length / 2 - 1] + durations[durations.length / 2]) / 2,
  maxDurationMs: durations.at(-1),
  successfulResponsesReportedCostUsd: successful.reduce((total, row) => total + (row.usage.costUsd ?? 0), 0),
  responsesMissingCost: successful.filter((row) => row.usage.costUsd === null).length,
};
save();
console.log(JSON.stringify({ report: output.pathname, summary: report.summary }, null, 2));
if (report.summary.failed > 0 || report.summary.allEightFieldsExact < report.summary.attempted) process.exitCode = 1;
