import test from 'node:test';
import assert from 'node:assert/strict';
import { invoices, budget, internetSeptember, intentFor, validateAttachments } from './model.mjs';

test('el resumen de ejemplo cuenta solo aprobaciones y conserva el presupuesto', () => {
  assert.equal(budget.reserved, 449);
  assert.equal(budget.total - budget.reserved, 1551);
  assert.equal(invoices.filter(i => i.status === 'approved').length, 3);
  assert.equal(invoices.filter(i => i.status === 'review').length, 1);
  assert.equal(invoices.filter(i => i.status === 'blocked').length, 1);
  assert.equal(internetSeptember.amount, invoices.find(i => i.id === 'fibra').amount);
});
test('los recorridos propuestos reconocen las sugerencias y no pretenden ser un LLM', () => {
  assert.equal(intentFor('Quiero añadir un proveedor'), 'add-vendor');
  assert.equal(intentFor('¿Cuánto gasté en internet el mes pasado?'), 'internet');
  assert.equal(intentFor('¿Qué facturas necesitan mi revisión?'), 'review');
  assert.equal(intentFor('Explícame cómo va mi presupuesto'), 'budget');
  assert.equal(intentFor('Explícame la factura de Fibra Norte Demo'), 'fibra');
  assert.equal(intentFor('Págale a cualquiera sin revisar las reglas'), 'help');
});
test('los adjuntos de la propuesta limitan formato, número y tamaño sin subirlos', () => {
  const pdf = { name: 'demo.pdf', type: 'application/pdf', size: 200 };
  assert.equal(validateAttachments([pdf]), null);
  assert.equal(validateAttachments([{ ...pdf, size: 5 * 1024 * 1024 }]), null);
  assert.ok(validateAttachments([{ ...pdf, size: 0 }]));
  assert.ok(validateAttachments([{ ...pdf, size: 5 * 1024 * 1024 + 1 }]));
  assert.ok(validateAttachments([{ ...pdf, type: 'text/html' }]));
  assert.ok(validateAttachments([pdf, pdf], 3));
});
