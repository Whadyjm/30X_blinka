# Facturas para la empresa demo de D1

Documentos completamente ficticios para `org_demo` (Lumen Atlas), separados del corpus
inmutable `fixtures/invoices` (Aurora). Coinciden con nombres/conceptos del seed SQL:

- `hosting.pdf`: USD 200, acuerdo mensual de hosting; elegible para APPROVE automático si
  las dos lecturas coinciden, no hay antecedentes duplicados y queda presupuesto.
- `accounting.pdf`: USD 450, acuerdo contable; ESCALATE autorizable con las reglas iniciales.
  El OWNER puede aprobar y se conserva la escalación anterior.

Las muestras representan octubre de 2026. Una vez aprobadas, subirlas como una acción nueva
produce duplicado: ese bloqueo es esperado. Repetir una petición con la misma clave UUID
reutiliza el registro original. Los smoke tests ya pueden haber dejado esos antecedentes;
consultar la lista antes de interpretar resultados.

No son facturas reales ni generan transferencias. Las decisiones dependen de la configuración
vigente, corroboración e historial, no de esta descripción. Ver [API](../../docs/API.md) y
[comprobación viva](../../apps/api/README.md).
