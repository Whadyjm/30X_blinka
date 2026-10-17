# Texto independiente de PDF para regresión

`captures.json` contiene las salidas reales de `AI.toMarkdown` de los 50 PDF originales y seis PDF
de `invoice-holdout`. Se capturaron el 17 de octubre de 2026 mediante el binding remoto de Workers AI,
con `pdf.metadata=false`, sin llamadas a OpenRouter ni escrituras en D1/R2. Cada captura identifica
el archivo original, su SHA-256, fecha, método, opciones y duración de conversión. Todos son ficticios.

El conversor recibió únicamente bytes del PDF y opciones de conversión; no recibió etiquetas,
campos esperados, contexto financiero ni la extracción candidata. Las referencias siguen en los
manifiestos originales. Las capturas se mantienen congeladas para repetir la comparación sin
cambiar simultáneamente conversión, modelo y parser. Estos diseños ya se usan para ajustar código:
son regresión, no un conjunto nuevo reservado.

Desde `apps/api`, ejecutar `node scripts/evaluate-pdf-parser.mjs --run` compara el parser anterior
del commit publicado `97538b9` con el actual, usando las mismas capturas y candidatos históricos reales.
La ejecución es offline: simula el transporte del proveedor y recalcula las advertencias de
comparación del servidor, conservando las advertencias originales del candidato. Comprueba los
hashes del PDF y registra hashes de código, capturas e informes de origen.

El reporte distingue exactitud de los ocho campos secundarios y `CROSS_CHECKED`. Ninguno acredita
una aprobación: este script no ejecuta el motor ni D1. El microbenchmark mide solo CPU local del
parser. Las nuevas lecturas remotas y decisiones locales con D1/R2 se informan por separado en
`docs/INVOICE_CORPUS_EVALUATION.md`.
