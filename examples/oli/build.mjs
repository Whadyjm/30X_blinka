import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'dist');
await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, 'renderer'), { recursive: true });
for (const file of ['index.html', 'style.css', 'assets']) {
  await cp(path.join(here, file), path.join(out, file), { recursive: true });
}
for (const file of ['renderer.js', 'particles.js']) {
  await cp(path.join(here, '../../packages/oli/src', file), path.join(out, 'renderer', file));
}
const demo = await readFile(path.join(here, 'demo.js'), 'utf8');
await writeFile(path.join(out, 'demo.js'), demo.replace('../../packages/oli/src/renderer.js', './renderer/renderer.js'));
console.log(`Demo lista: ${out}`);

// Workers Assets maps request paths to the same directory structure on disk.
if (process.argv.includes('--domain')) {
  const assets = path.join(here, '.wrangler/domain-assets');
  await rm(assets, { recursive: true, force: true });
  await mkdir(assets, { recursive: true });
  await cp(out, path.join(assets, 'oli'), { recursive: true });
  console.log(`Assets para /oli/: ${assets}`);
}
