import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

assert.deepEqual(process.argv.slice(2), ['--run']);
const root = new URL('../../../', import.meta.url);
const output = new URL('docs/fixtures/company-journey/pdf-text-captures-20261017.json', root);
assert.ok(!existsSync(output), 'Preserve existing captures; never overwrite a measured run');
// Capture stdout privately: never print, persist or pass a credential through shell arguments.
const auth = JSON.parse(execFileSync(new URL('../node_modules/.bin/wrangler', import.meta.url).pathname,
  ['auth', 'token', '--json'], { cwd: new URL('../', import.meta.url), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
assert.ok(auth.token);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { scope: 'NEW_REAL_PDF_CONVERSIONS_NO_PRIMARY_MODELS_OR_FINANCIAL_WRITES',
  converter: 'Workers AI toMarkdown REST', conversionOptions: { pdf: { metadata: false } },
  note: 'Debug captures made after the original evaluation; not the historical text output. Five exploratory conversions preceded this collection.',
  startedAt: new Date().toISOString(), finishedAt: null, captures: [] };
const save = () => {
  const json = JSON.stringify(report, null, 2) + '\n';
  assert.ok(!json.includes(auth.token));
  writeFileSync(output, json);
};
save();
for (const company of ['brisa', 'cedro', 'lumen']) {
  const manifest = JSON.parse(readFileSync(new URL(`docs/fixtures/company-journey/${company}/manifest.json`, root)));
  for (const row of manifest.cases.filter(row => row.file.mimeType === 'application/pdf')) {
    if (report.captures.some(capture => capture.company === company && capture.sourceSha256 === row.file.sha256)) continue;
    const sourceFile = `docs/fixtures/company-journey/${company}/${row.file.path}`;
    const bytes = readFileSync(new URL(sourceFile, root));
    assert.equal(hash(bytes), row.file.sha256);
    const body = new FormData();
    body.append('files', new Blob([bytes], { type: 'application/pdf' }), 'invoice.pdf');
    body.append('conversionOptions', JSON.stringify(report.conversionOptions));
    const response = await fetch('https://api.cloudflare.com/client/v4/accounts/fbaa64f96579f93b2db32a1eb12ff6c9/ai/tomarkdown', {
      method: 'POST', headers: { Authorization: `Bearer ${auth.token}` }, body, signal: AbortSignal.timeout(30000) });
    assert.ok(response.ok, `Conversion HTTP_${response.status}`);
    const payload = await response.json(), result = payload.result?.[0];
    assert.ok(payload.success && result?.format !== 'error' && typeof result?.data === 'string', 'Conversion unavailable');
    report.captures.push({ company, caseId: row.id, sourceFile, sourceSha256: hash(bytes),
      capturedAt: new Date().toISOString(), text: result.data, textSha256: hash(result.data) });
    save(); console.log(JSON.stringify({ company, caseId: row.id, captured: report.captures.length }));
  }
}
report.finishedAt = new Date().toISOString(); save();
