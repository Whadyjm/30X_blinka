// All records are illustrative. This module has no API or payment authority.
export const invoices = Object.freeze([
  { id: 'acme', vendor: 'Acme Accounting Demo', concept: 'Contabilidad · OCT-026', amount: 450, status: 'review', reason: 'El importe de USD 450 supera el límite automático de USD 300. Requiere revisión de una persona autorizada; no se ha reservado presupuesto.' },
  { id: 'cloud', vendor: 'Cloud Hosting Demo', concept: 'Infraestructura · OCT-014', amount: 200, status: 'approved', reason: 'Coincide con el acuerdo del proveedor, está dentro del límite automático y tiene presupuesto disponible. Autorización simulada; no se ejecutó un pago.' },
  { id: 'fibra', vendor: 'Fibra Norte Demo', concept: 'Internet · OCT-008', amount: 89, status: 'approved', reason: 'Servicio mensual de internet por USD 89, coincidente con su acuerdo. Autorización simulada; no se ejecutó un pago.' },
  { id: 'pixel', vendor: 'Pixel Mesa Demo', concept: 'Diseño · OCT-011', amount: 120, status: 'blocked', reason: 'El número de factura ya aparece en el historial del proveedor. Este cobro duplicado no crea otra reserva de presupuesto.' },
  { id: 'linea', vendor: 'Línea Studio Demo', concept: 'Herramientas · OCT-003', amount: 160, status: 'approved', reason: 'Coincide con el acuerdo vigente y respeta el mandato. Autorización simulada; no se ejecutó un pago.' },
]);
export const internetSeptember = Object.freeze({ vendor: 'Fibra Norte Demo', amount: 89, invoice: 'SEP-008', period: 'septiembre de 2026' });
export const budget = Object.freeze({ total: 2000, reserved: invoices.filter(i => i.status === 'approved').reduce((sum, i) => sum + i.amount, 0) });
export const hints = Object.freeze(['Quiero agregar un proveedor…', '¿Cuánto gasté en internet el mes pasado?', '¿Qué facturas necesitan mi revisión?', 'Explícame cómo va mi presupuesto…']);
export function intentFor(text) {
  const s = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/\b(paga|pagale|transferir|transfiere)\b/.test(s)) return 'help';
  if (/proveedor/.test(s)) return /agregar|anadir|nuevo|crear|registrar|alta/.test(s) ? 'add-vendor' : 'vendors';
  if (/factura.*fibra/.test(s)) return 'fibra';
  if (/internet|fibra/.test(s)) return 'internet';
  if (/presupuesto|mi mes|este mes|resumen|cuanto gaste/.test(s)) return 'budget';
  if (/duplicad|pixel|bloquead|rechazad/.test(s)) return 'blocked';
  if (/cloud|hosting/.test(s)) return 'cloud';
  if (/linea studio/.test(s)) return 'linea';
  if (/atencion|pendiente|revis|acme|aproba/.test(s)) return 'review';
  if (/factura|subir|adjunt/.test(s)) return 'upload';
  return 'help';
}
export function validateAttachments(files, existing = 0) {
  if (existing + files.length > 4) return 'Adjunta hasta 4 facturas a la vez. Puedes quitar un archivo y volver a intentarlo.';
  for (const f of files) {
    if (!['application/pdf', 'image/png', 'image/jpeg'].includes(f.type)) return 'Ese formato no está admitido. Prueba con un PDF, PNG o JPG.';
    if (f.size === 0 || f.size > 5 * 1024 * 1024) return 'Cada archivo debe tener contenido y pesar como máximo 5 MB.';
  }
  return null;
}
