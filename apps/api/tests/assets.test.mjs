import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../worker/index.js';

test('las rutas de la web usan ASSETS, las rutas API nunca reciben el fallback HTML', async () => {
  let assetRequests = 0;
  const env = { ASSETS: { fetch: async () => { assetRequests++; return new Response('<main>Oli</main>', { headers: { 'Content-Type': 'text/html' } }); } } };
  assert.equal((await worker.fetch(new Request('https://oli.invalid/app/bills'), env)).status, 200);
  assert.equal(assetRequests, 1);
  assert.equal((await worker.fetch(new Request('https://oli.invalid/api/unknown'), env)).status, 404);
  assert.equal((await worker.fetch(new Request('https://oli.invalid/api/v1/invoices'), env)).status, 401);
  assert.equal(assetRequests, 1);
});
