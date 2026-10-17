import { mkdir, cp, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(root, 'dist/propuesta');
await rm(path.join(root, 'dist'), { recursive: true, force: true });
await mkdir(path.join(out, 'renderer'), { recursive: true });
for (const file of ['index.html', 'style.css', 'model.mjs', 'assets']) await cp(path.join(root, file), path.join(out, file), { recursive: true });
for (const file of ['renderer.js', 'particles.js']) await cp(path.join(root, '../../packages/oli/src', file), path.join(out, 'renderer', file));
const app = await readFile(path.join(root, 'app.js'), 'utf8');
await writeFile(path.join(out, 'app.js'), app.replace('../../packages/oli/src/renderer.js', './renderer/renderer.js'));
await writeFile(path.join(root, 'dist/_headers'), '/propuesta/*\n  X-Robots-Tag: noindex, nofollow\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Content-Type-Options: nosniff\n  Content-Security-Policy: default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\'; font-src \'self\'; connect-src \'none\'; frame-ancestors \'none\'; base-uri \'self\'; form-action \'self\'\n');
console.log('Propuesta compilada en examples/conversation-proposal/dist/propuesta/. Renderer de Oli reutilizado sin modificar su fuente.');
