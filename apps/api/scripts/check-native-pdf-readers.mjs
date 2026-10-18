import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { normalizeInvoiceNumber } from '@oli/domain';
import { normalizeName } from '../worker/http.js';
import { READER_VERSION } from '../worker/document.js';

assert.deepEqual(process.argv.slice(2), ['--run']);
const root = new URL('../../../', import.meta.url), token = readFileSync(new URL('.env.extraction-probe', root), 'utf8').trim();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const output = new URL('docs/evaluations/native-pdf-critical-readers-20261017.json', root);
const report = { scope: 'KNOWN_DOCUMENT_NATIVE_PDF_READER_REGRESSION_NOT_FRESH_E2E',
  startedAt: new Date().toISOString(), readerVersion: READER_VERSION,
  candidate: JSON.parse(readFileSync(new URL('docs/evaluations/candidate-release-20261017.json', root))),
  limits: { maximumCalls: 5, externalRetries: 0, financialWrites: false }, results: [] };
const save = () => { const body = JSON.stringify(report, null, 2) + '\n'; assert.ok(!body.includes(token)); writeFileSync(output, body); };
for (const [company, id] of [['selva', '005'], ['lumen', '003'], ['lumen', '006'], ['lumen', '007'], ['marena', '019']]) {
  const fixture = `docs/fixtures/company-journey/${company}/`;
  const manifest = JSON.parse(readFileSync(new URL(fixture + 'manifest.json', root)));
  const scenario = manifest.cases.find(c => c.id === id), bytes = readFileSync(new URL(fixture + scenario.file.path, root));
  assert.equal(hash(bytes), scenario.file.sha256);
  const row = { company, caseId: id, file: scenario.file, startedAt: new Date().toISOString() };
  try {
    const response = await fetch('https://oli30x.ultramare.dev/api/internal/document-probe', { method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': scenario.file.mimeType, 'X-Oli-Provider-Diagnostic': '1' },
      body: bytes, signal: AbortSignal.timeout(65000) });
    row.status = response.status; row.response = await response.json();
    const read = row.response.data;
    if (read) {
      assert.equal(read.documentSha256, scenario.file.sha256); assert.equal(read.provenance.configVersion, READER_VERSION);
      const fields = Object.keys(scenario.expectedExtraction);
      row.literalFields = fields.filter(k => read.extraction[k] === scenario.expectedExtraction[k]);
      row.policyEquivalentFields = fields.filter(k => k === 'invoiceNumber'
        ? normalizeInvoiceNumber(read.extraction[k]) === normalizeInvoiceNumber(scenario.expectedExtraction[k])
        : ['vendorName', 'description'].includes(k) ? normalizeName(read.extraction[k] ?? '') === normalizeName(scenario.expectedExtraction[k] ?? '')
          : read.extraction[k] === scenario.expectedExtraction[k]);
      row.pass = scenario.expectedDocumentType === 'INVOICE'
        ? row.policyEquivalentFields.length === 8 && !read.extraction.extractionWarnings.length && read.documentType === 'INVOICE'
        : read.documentType === scenario.expectedDocumentType;
    } else row.pass = false;
  } catch (error) { row.error = { name: error.name, message: error.message }; row.pass = false; }
  report.results.push(row); save();
  console.log(JSON.stringify({ company, id, pass: row.pass, status: row.status, model: row.response?.data?.provenance.model,
    error: row.response?.error?.code }));
  if (!row.pass) break;
}
report.finishedAt = new Date().toISOString(); report.pass = report.results.length === 5 && report.results.every(row => row.pass); save();
if (!report.pass) process.exitCode = 1;
