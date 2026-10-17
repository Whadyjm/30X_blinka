// Lists t('…') string literals in src/ that have no Spanish entry in src/i18n/es.*.ts
// (and Spanish keys never referenced by a literal t() call are NOT reported: some keys are used via constants).
// Usage: node tools/check-i18n.mjs      (exit code 1 if anything is missing)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = new URL('../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const unesc = (s) => s.replace(/\\(['"`\\])/g, '$1').replace(/\\n/g, '\n');

// 1) Spanish keys
const keys = new Set();
for (const f of walk(join(SRC, 'i18n')).filter((f) => /es\.[\w]+\.ts$/.test(f))) {
  const text = readFileSync(f, 'utf8');
  const re = /^\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|([A-Za-z_$][\w$]*))\s*:/gm;
  let m;
  while ((m = re.exec(text))) keys.add(unesc(m[1] ?? m[2] ?? m[3]));
}

// 2) t('…') literals
const missing = new Map();
const callRe = /(?<![\w.$])t\(\s*(['"`])((?:\\[\s\S]|(?!\1)[^\\])*)\1/g;
for (const f of walk(SRC)) {
  if (f.includes(`${join(SRC, 'i18n')}`) || /\.test\.tsx?$/.test(f) || f.includes(join(SRC, 'api', 'mock'))) continue;
  const text = readFileSync(f, 'utf8');
  let m;
  while ((m = callRe.exec(text))) {
    if (m[1] === '`' && m[2].includes('${')) continue; // dynamic template: cannot be a static key
    const key = unesc(m[2]);
    if (!keys.has(key)) {
      const line = text.slice(0, m.index).split('\n').length;
      if (!missing.has(key)) missing.set(key, `${relative(SRC, f)}:${line}`);
    }
  }
}

if (missing.size === 0) {
  console.log(`i18n OK — ${keys.size} Spanish keys, every t('…') literal is covered.`);
} else {
  console.log(`Missing Spanish translations (${missing.size}):`);
  for (const [k, where] of missing) console.log(`  ${where}  ${JSON.stringify(k)}`);
  process.exit(1);
}
