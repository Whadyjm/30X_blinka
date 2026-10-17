import assert from "node:assert/strict";
import test from "node:test";
import worker from "../worker/index.js";

test("health solo confirma éxito después de consultar el binding D1", async () => {
  let queried = false;
  const env = { DB: { prepare: () => ({ first: async () => { queried = true; return { ok: 1 }; } }) } };
  const response = await worker.fetch(new Request("https://oli.invalid/api/health"), env);
  assert.equal(queried, true);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: "oli-api" });
});

test("D1 no disponible devuelve 503 sin exponer el error interno", async (t) => {
  t.mock.method(console, "error", () => {});
  const env = { DB: { prepare: () => ({ first: async () => { throw new Error("internal-database-detail"); } }) } };
  const response = await worker.fetch(new Request("https://oli.invalid/api/health"), env);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, service: "oli-api" });
  assert.equal(console.error.mock.calls.length, 1);
});

test("facturas requieren sesión antes de consultar D1", async () => {
  const response = await worker.fetch(new Request("https://oli.invalid/api/v1/invoices"), {});
  assert.equal(response.status, 401);
});
