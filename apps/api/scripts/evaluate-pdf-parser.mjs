import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { checkExtraction } from '@oli/contracts';
import { parsePdfText, readDocument, READER_VERSION } from '../worker/document.js';

assert.deepEqual(process.argv.slice(2), ['--run'], 'Use --run; this comparison is offline and makes no paid calls');
const root = new URL('../../../', import.meta.url);
const load = path => JSON.parse(readFileSync(new URL(path, root)));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const baselineCommit = '97538b95dd41484e4aade13dedc49b2af424fb4b';
const baselineSource = execFileSync('git', ['show', baselineCommit + ':apps/api/worker/document.js'], { cwd: root });
const capturePath = 'docs/fixtures/pdf-text-regression/captures.json';
const { captures } = load(capturePath);
assert.equal(captures.length, 56);
const sources = [
  { manifest: 'fixtures/scenarios/invoices.json', primary: 'docs/evaluations/invoices-pdf-2026-10-17T16-24-08-411Z.json' },
  { manifest: 'docs/fixtures/invoice-holdout/manifest.json', primary: 'docs/evaluations/invoices-holdout-2026-10-17T16-24-34-506Z.json' },
];
const scenarios = new Map(sources.flatMap(source => load(source.manifest).cases.map(c => [c.id, c])));
const primaryReads = new Map(sources.flatMap(source => load(source.primary).results.map(row => [row.caseId, row.read])));
const temporaryRoot = new URL('../.wrangler/', import.meta.url);
mkdirSync(temporaryRoot, { recursive: true });
const directory = mkdtempSync(temporaryRoot.pathname + 'parser-baseline-');
const baselinePath = directory + '/document.mjs';
writeFileSync(baselinePath, baselineSource.toString().replace("from './http.js'", `from '${new URL('../worker/http.js', import.meta.url).href}'`));
const originalFetch = globalThis.fetch;
try {
  const baseline = await import(pathToFileURL(baselinePath));
  const report = { measuredAt: new Date().toISOString(), scope: 'OFFLINE_PAIRED_PARSER_AND_READER_COMPARISON',
    baseline: { commit: baselineCommit, sourceSha256: sha(baselineSource), readerVersion: baseline.READER_VERSION },
    current: { sourceSha256: sha(readFileSync(new URL('apps/api/worker/document.js', root))), readerVersion: READER_VERSION },
    sources: sources.map(source => ({ ...source, primarySha256: sha(readFileSync(new URL(source.primary, root))) })),
    captureSha256: sha(readFileSync(new URL(capturePath, root))),
    limits: { liveModelCalls: 0, financialDecisions: 'NOT_EVALUATED',
      primary: 'Frozen real primary reads from cited historical reports; only server-derived comparison warnings are recalculated.',
      secondary: 'Frozen real Workers AI conversions, bound to original PDF bytes by SHA-256.',
      timing: 'Local parser CPU only; excludes network, conversion, OCR, model inference, engine, D1 and queue.',
      generalization: 'These documents have been used for tuning; this is regression, not an unseen holdout.' }, results: [], summary: {} };
  for (const capture of captures) {
    const scenario = scenarios.get(capture.caseId), primary = primaryReads.get(capture.caseId);
    assert.equal(sha(readFileSync(new URL(capture.sourceFile, root))), capture.sourceSha256);
    assert.equal(capture.sourceSha256, scenario.file.sha256);
    assert.equal(primary.documentSha256, capture.sourceSha256);
    const derived = new Set([...(primary.provenance.independentDisagreements ?? []).map(field => `INDEPENDENT_READ_MISMATCH:${field}`),
      ...(primary.provenance.independentIssues ?? [])]);
    const extraction = { ...primary.extraction, extractionWarnings: primary.extraction.extractionWarnings.filter(warning => !derived.has(warning)) };
    // Provider transport is replayed, not measured. Expected labels never enter either reader.
    globalThis.fetch = async url => {
      assert.equal(String(url), 'https://openrouter.ai/api/v1/chat/completions');
      return Response.json({ model: 'frozen-primary-replay', choices: [{ finish_reason: 'stop', message: {
        content: JSON.stringify({ ...extraction, documentType: primary.documentType }) } }] });
    };
    const bytes = readFileSync(new URL(capture.sourceFile, root));
    const env = { OPENROUTER_API_KEY: 'offline-replay-only', AI: { toMarkdown: async () => ({ format: 'markdown', data: capture.text }) } };
    const row = { caseId: capture.caseId, sourceSha256: capture.sourceSha256, before: null, after: null };
    for (const [key, parser, reader] of [['before', baseline.parsePdfText, baseline.readDocument], ['after', parsePdfText, readDocument]]) {
      const parsed = parser(capture.text);
      const read = await reader(env, { mimeType: 'application/pdf' }, bytes, capture.sourceSha256);
      const checked = checkExtraction({ documentSha256: capture.sourceSha256, primaryReadId: read.primaryReadId,
        candidate: read.extraction, corroboration: read.corroboration });
      row[key] = { parsed, exactFields: Object.keys(parsed.fields).filter(field => parsed.fields[field] === scenario.expectedExtraction[field]),
        independentStatus: checked.status, warnings: read.extraction.extractionWarnings };
    }
    report.results.push(row);
  }
  // Warm both functions; alternate order to reduce first-run and ordering bias.
  for (const parser of [baseline.parsePdfText, parsePdfText]) for (const capture of captures) parser(capture.text);
  const cpu = { before: [], after: [] };
  for (let iteration = 0; iteration < 100; iteration++) {
    const order = iteration % 2 ? [['after', parsePdfText], ['before', baseline.parsePdfText]] : [['before', baseline.parsePdfText], ['after', parsePdfText]];
    for (const [key, parser] of order) for (const capture of captures) {
      const start = performance.now(); parser(capture.text); cpu[key].push(performance.now() - start);
    }
  }
  for (const key of ['before', 'after']) {
    const times = cpu[key].sort((a, b) => a - b);
    report.summary[key] = { parserMedianMs: times[Math.floor(times.length / 2)], parserP95Ms: times[Math.floor(times.length * 0.95)], parserSamples: times.length,
      original50: { secondaryAllEightExact: report.results.filter(row => row.caseId.startsWith('case_') && row[key].exactFields.length === 8).length },
      additionalSixPdfs: { secondaryAllEightExact: report.results.filter(row => row.caseId.startsWith('holdout_') && row[key].exactFields.length === 8).length,
        independentCrossChecked: report.results.filter(row => row.caseId.startsWith('holdout_') && row[key].independentStatus === 'CROSS_CHECKED').length } };
  }
  assert.equal(report.results.find(row => row.caseId === 'holdout_006').after.independentStatus, 'REVIEW_REQUIRED');
  assert.equal(report.results.find(row => row.caseId === 'holdout_007').after.independentStatus, 'REVIEW_REQUIRED');
  const output = new URL(`docs/evaluations/pdf-parser-${READER_VERSION.split(':')[0].replace('labelled-', '')}-paired.json`, root);
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output: output.pathname, summary: report.summary }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
  rmSync(directory, { recursive: true, force: true });
}
