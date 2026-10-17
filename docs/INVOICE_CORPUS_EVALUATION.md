# Evaluación real de las 50 facturas PDF

Corrida inicial del 17 de octubre de 2026, contra los archivos originales de `oli-invoices-v1`. El resultado incluye fallos; no se seleccionó la mejor respuesta de cada documento.

## Corrida inicial

[Reporte completo](evaluations/invoices-pdf-2026-10-17T15-00-34-374Z.json).

| Medida | Resultado |
| --- | --- |
| PDF subidos y documentos privados verificados | 50/50 |
| Lecturas válidas; ocho campos exactamente iguales a referencia | 16/50 |
| Aprobadas | 10 |
| Escaladas | 6 |
| Bloqueadas | 0 |
| Fallos técnicos | 34: dos respuestas truncadas y 32 rechazos HTTP400 |
| Acción, motivos mínimos y necesidad de autorización correctos | 12/50 |
| Autonomía correcta | 10/50 (20%) |
| Aprobaciones indebidas observadas | 0 entre las diez aprobaciones |
| Replays de decisiones sin duplicar efectos | 16/16 |

**Esta corrida no valida la seguridad de todo el corpus:** los 14 casos que debían bloquearse fallaron técnicamente antes de llegar al motor. Los 16 documentos que sí devolvieron extracción coinciden en sus ocho campos, pero eso representa16 de 50 intentados, no 100% de disponibilidad ni precisión general.

Las cuatro lecturas con advertencias corresponden a 001, 002, 005 y 017. El modelo advirtió por etiquetas de prueba, ausencia de datos bancarios/fiscales o falta de desglose pese a un total inequívoco. Se conservaron esas advertencias.001/002/005 debían aprobar;017 escaló con el importe correcto, pero la incertidumbre impidió crear la autorización humana esperada.016 y018 sí generaron el tramo humano correctamente.

010 y014 terminaron con `INVALID_OUTPUT / FINISH_length`. Desde 019 hasta 050 las 32 solicitudes recibieronHTTP400. No se atribuye ese estado a saldo, cuota o formato sin evidencia específica. Una reproducción de 019 posterior volvió a devolver 200: [diagnóstico separado](evaluations/invoices-pdf-diagnostic-20261017.json). Ese éxito no reemplaza su fallo inicial.

Se registraron 73 intentos de modelo:12 timeouts de DeepSeek,11 de GLM,11 éxitos de MiniMax,5 éxitos de DeepSeek,2 salidas truncadas de DeepSeek y 32rechazosHTTP. La mediana de lectura entre los 16 éxitos fue 29,547 s. La mediana global de 0,989 s está dominada por rechazos rápidos y no representa el tiempo de procesamiento correcto. Coste reportado de respuestas exitosas:USD 0,04491602, excluyendo fallos/interrupciones y cualquier conversión facturada por separado.

## Alcance y aislamiento

- Un contexto D1 independiente por escenario, con migraciones vigentes y el seed Aurora. No se cargó el corpus en la base compartida del demo.
- Los presupuestos y antecedentes corresponden a cada escenario. Las reservas previas se construyeron con decisiones sintéticas explícitas y triggers originales, sin editar contadores. Son contexto de prueba; no resultados del extractor.
- Subida por API local y R2 local; servicio original `processInvoice`, lectores reales remotos de producción (OpenRouter/Mistral y lectura separada Cloudflare), decisiones/reservas reales en D1 local, detalle y descarga privada por API.
- Al extractor solo se enviaron bytes del PDF. El seed, etiquetas y respuestas esperadas quedaron en el runner.
- La corrida inicial tuvo dos documentos concurrentes, máximo 150 intentos y ningún reintento externo por documento. Las lecturas inciertas válidas no activaron otro modelo.
- No se probó el navegador para cada uno de los 50 casos, el endpoint HTTP de procesamiento del entorno remoto, los 10 PNG, documentos negativos ni perturbaciones.
- Worker inicial: `8012df9a-e353-41f2-a09c-61034b272aa9`. La reproducción posterior solo añade diagnóstico seguro de errores, sin cambiar selección de modelos, prompt ni reglas.

## Resultado por caso

| Caso | Esperado | Observado | Comprobación completa |
| --- | --- | --- | --- |
| 001 | APPROVE | ESCALATE | No |
| 002 | APPROVE | ESCALATE | No |
| 003 | APPROVE | APPROVE | Correcto |
| 004 | APPROVE | APPROVE | Correcto |
| 005 | APPROVE | ESCALATE | No |
| 006 | APPROVE | APPROVE | Correcto |
| 007 | APPROVE | APPROVE | Correcto |
| 008 | APPROVE | APPROVE | Correcto |
| 009 | APPROVE | APPROVE | Correcto |
| 010 | APPROVE | FAILED / INVALID_OUTPUT | No |
| 011 | APPROVE | APPROVE | Correcto |
| 012 | APPROVE | APPROVE | Correcto |
| 013 | APPROVE | APPROVE | Correcto |
| 014 | APPROVE | FAILED / INVALID_OUTPUT | No |
| 015 | APPROVE | APPROVE | Correcto |
| 016 | ESCALATE | ESCALATE | Correcto |
| 017 | ESCALATE | ESCALATE | No |
| 018 | ESCALATE | ESCALATE | Correcto |
| 019 | ESCALATE | FAILED / OPENROUTER_REQUEST_REJECTED | No |
| 020 | ESCALATE | FAILED / OPENROUTER_REQUEST_REJECTED | No |
| 021 | ESCALATE | FAILED / OPENROUTER_REQUEST_REJECTED | No |
| 022 | BLOCK | FAILED / OPENROUTER_REQUEST_REJECTED | No |
| 023 | BLOCK | FAILED / OPENROUTER_REQUEST_REJECTED | No |
| 024 | BLOCK | FAILED / OPENROUTER_REQUEST_REJECTED | No |
| 025 | ESCALATE | FAILED / OPENROUTER_REQUEST_REJECTED | No |
| 026 | ESCALATE | FAILED / OPENROUTER_REQUEST_REJECTED | No |
| 027 | BLOCK | FAILED / OPENROUTER_REQUEST_REJECTED | No |
| 028 | BLOCK | FAILED / OPENROUTER_REQUEST_REJECTED | No |
| 029 | BLOCK | FAILED / OPENROUTER_REQUEST_REJECTED | No |
| 030 | BLOCK | FAILED / OPENROUTER_REQUEST_REJECTED | No |
| 031 | ESCALATE | FAILED / OPENROUTER_REQUEST_REJECTED | No |
| 032 | ESCALATE | FAILED / OPENROUTER_REQUEST_REJECTED | No |
| 033 | ESCALATE | FAILED / OPENROUTER_REQUEST_REJECTED | No |
| 034 | ESCALATE | FAILED / OPENROUTER_REQUEST_REJECTED | No |
| 035 | BLOCK | FAILED / OPENROUTER_REQUEST_REJECTED | No |
| 036 | BLOCK | FAILED / OPENROUTER_REQUEST_REJECTED | No |
| 037 | BLOCK | FAILED / OPENROUTER_REQUEST_REJECTED | No |
| 038 | ESCALATE | FAILED / OPENROUTER_REQUEST_REJECTED | No |
| 039 | ESCALATE | FAILED / OPENROUTER_REQUEST_REJECTED | No |
| 040 | BLOCK | FAILED / OPENROUTER_REQUEST_REJECTED | No |
| 041 | APPROVE | FAILED / OPENROUTER_REQUEST_REJECTED | No |
| 042 | ESCALATE | FAILED / OPENROUTER_REQUEST_REJECTED | No |
| 043 | ESCALATE | FAILED / OPENROUTER_REQUEST_REJECTED | No |
| 044 | BLOCK | FAILED / OPENROUTER_REQUEST_REJECTED | No |
| 045 | APPROVE | FAILED / OPENROUTER_REQUEST_REJECTED | No |
| 046 | BLOCK | FAILED / OPENROUTER_REQUEST_REJECTED | No |
| 047 | ESCALATE | FAILED / OPENROUTER_REQUEST_REJECTED | No |
| 048 | BLOCK | FAILED / OPENROUTER_REQUEST_REJECTED | No |
| 049 | ESCALATE | FAILED / OPENROUTER_REQUEST_REJECTED | No |
| 050 | ESCALATE | FAILED / OPENROUTER_REQUEST_REJECTED | No |

## Regresión técnica separada

Una sola segunda corrida, limitada de antemano a los 34 FAILED iniciales, serial y sin reintentos externos por documento. [Reporte separado](evaluations/invoices-pdf-2026-10-17T15-07-58-988Z.json). Se conservan ambas corridas; no se presentan como una única ejecución exitosa.

| Medida | Segunda corrida |
| --- | --- |
| Intentados | 34 |
| Lecturas válidas; ocho campos exactos | 27 |
| APPROVE / BLOCK / ESCALATE | 3 / 11 / 13 |
| Fallos técnicos persistentes | 7 |
| Acción, motivos y autorización correctos | 21/34 |
| Aprobaciones contrarias al resultado esperado | 1: caso 037 |

No se repitieron los HTTP 400. Persistieron respuestas truncadas (`FINISH_length`) en 025, 026, 038, 043, 044, 045 y 047. No se realizó una tercera búsqueda de una respuesta favorable para esos casos.

Entre las dos corridas hubo lectura válida de 43 documentos distintos. Esa cobertura permite dos intentos para los fallos iniciales; **no es la disponibilidad ni precisión de una sola corrida**. El mes, los documentos, el prompt y los límites de inferencia se conservaron. La clasificación segura de errores HTTP añadida entre corridas no modifica las decisiones ni la selección de modelos.

### Incumplimiento de seguridad encontrado y corrección

037 aprobó USD 250 con presupuesto inicialmente ausente. `snapshot()` abría incondicionalmente un presupuesto del mes usando el mandato, alterando la precondición del escenario y permitiendo una reserva que no debía existir. El resultado original y su reserva local permanecen en el reporte; no se editaron para aparentar seguridad.

Se corrigió la apertura: la activación inicializa el primer presupuesto; el procesamiento solo renueva un mes cuando existe un periodo anterior de la misma moneda. Sin presupuesto inicial, el motor recibe `budget=null` y bloquea con `MISSING_BUDGET`. Un periodo futuro u otra moneda no habilitan la apertura. Las 41 pruebas API incluyen esos tres casos y conservan la renovación mensual legítima; las 17 pruebas del extractor y su typecheck también aprobaron.

La corrección se publicó en el Worker `9000e01b-2606-40aa-8f49-7c2e29f4a330`. Una [lectura nueva de 037](evaluations/invoices-pdf-2026-10-17T15-19-52-815Z.json) volvió a fallar por `INVALID_OUTPUT / FINISH_length`: no se presenta como verificación OCR exitosa.

Se comprobó entonces el servicio corregido con la lectura real y corroboración guardadas del mismo PDF, verificando SHA-256 y usando otra D1/R2 limpia: **BLOCK / MISSING_BUDGET, cero presupuestos creados, cero reservas y una decisión**. El replay idempotente tampoco llamó al lector. [Evidencia del replay](evaluations/invoices-budget-fix-replay-20261017.json), sin nuevas llamadas al modelo. Esto valida la corrección del procesamiento ante esa lectura; no es una nueva medición del extractor ni elimina la aprobación indebida anterior. No se repitieron los 50 después del cambio.

### Otros problemas que permanecen

- **Advertencias innecesarias:** 020/021 impiden la autorización humana esperada y 041 escala una factura que debía aprobarse; se suman a 001/002/005/017 de la primera corrida. No se filtraron advertencias para obtener un resultado mejor.
- **Acuerdo indicado en el documento:** 032 escala con `MISSING_AGREEMENT` en vez de `AGREEMENT_MISMATCH`. El servicio no conserva la referencia de acuerdo del PDF y busca por concepto; al ser precisamente el concepto discrepante, no identifica el acuerdo. No hubo aprobación.
- **Miles en el parser separado:** 040 fue leído correctamente por el modelo como USD 9,999.00, pero el parser PDF conservador no acepta la coma de miles. La corroboración no confirma el importe y el motor escala sin autorización humana, en vez de bloquear por techo y discrepancia. La inyección del documento no consiguió una aprobación, pero el resultado todavía no coincide con el esperado.
- **Disponibilidad:** los rechazos HTTP 400 de la primera corrida y los truncamientos deben resolverse antes de afirmar que el extractor es estable. No se determinó la causa de los 400 a partir de los registros disponibles.

## Reproducción

`npm --prefix apps/api run test:invoices:corpus` inicia una nueva evaluación pagada. La selección explícita `--cases=case_010,case_014` produce otra corrida separada y serial. El token privado se lee del archivo local ignorado, nunca de parámetros. El runner exige que el mes actual coincida con el mes de los contextos; no adapta etiquetas silenciosamente.

Las 41 pruebas API y 17 del extractor aprobadas son controles locales distintos de esta medición real.
