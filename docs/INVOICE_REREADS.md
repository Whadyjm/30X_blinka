# Releer el original de una factura no resuelta

`POST /api/v1/invoices/:id/reread` usa sesión OWNER, CSRF, origen e Idempotency-Key. Acepta el mismo objeto estricto que `/reevaluate`: `expectedDecisionId` y `expectedPolicyVersionId`. No recibe clasificación, campos extraídos, excepciones ni autorización del navegador.

Responde 202 con `{data: InvoiceDetail}` en estado RECEIVED. La UI consulta la misma factura hasta completar la lectura. Una decisión anterior permanece en su historial mientras procesa; no representa una nueva aprobación.

- `/reevaluate` aplica reglas actuales sobre una lectura guardada.
- `/reread` solicita una lectura nueva del archivo privado existente, con el adapter actual y corroboración. No sube ni duplica la factura.

La migración 0011 agrega un historial append-only `invoice_rereads` con la lectura y los hechos anteriores. El documento, su hash y las decisiones previas permanecen inmutables. Solo una solicitud OWNER válida puede reabrir el job DONE y permitir que el procesador actualice la proyección de datos de una factura todavía no resuelta. El alta de proveedor confirmada conserva su excepción existente.

La solicitud invalida aprobaciones pendientes y conserva el presupuesto de intentos del job (máximo tres, sin reinicio). Comparte la cuota y el cooldown por hash de los reanálisis. La intención se guarda en D1 antes de publicar en la cola; el scheduler recupera una publicación fallida. Los artefactos de la nueva lectura tienen un espacio de caché propio para no reutilizar los resultados que se están revisando.

Facturas autorizadas, con reserva o rechazadas por una persona no se reabren. La nueva decisión sigue aplicando reglas vigentes, identidad, duplicados, extracción y reserva atómica. No se ejecutan pagos reales.
