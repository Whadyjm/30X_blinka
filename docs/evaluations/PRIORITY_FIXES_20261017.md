# Correcciones prioritarias de los recorridos de empresas

El motor local ya frena el duplicado que se autorizó indebidamente en Brisa. Las correcciones de lectura independiente aumentan los recorridos correctos de 27/60 a 50/60 en regresión, conservando la abstención ante discrepancias. Se observaron cero aprobaciones indebidas en la repetición; falta una corrida nueva con lectores reales para medir la candidata completa.

## Correcciones implementadas

| Prioridad | Fallo y corrección | Evidencia |
| --- | --- | --- |
| P0 | Un antecedente con `vendorId=null` no descartaba la aprobación de otro documento con el mismo proveedor y número. Ahora requiere aclaración por `POSSIBLE_DUPLICATE`, sin reserva ni excepción humana genérica. Los duplicados con identidad resuelta siguen bloqueados. | Regresión de dominio y API con D1; Brisa 001→012 repetida con lecturas originales intactas: `ESCALATE`, cero reservas en 012. |
| P1 | `toMarkdown` pega etiquetas al concepto y notas al total, dejando importes sin corroborar. El parser v7 reconoce esas separaciones y conserva texto PDF y SHA-256 calculado por el servidor en la procedencia privada. | 33 capturas nuevas de los PDF originales, de las cuales 29 son facturas con los ocho campos esperados. Pasan también las 56 capturas de regresión anteriores. |
| P1 | Qwen produjo puntuación `: :` en Brisa 006 y etiquetas sin dos puntos en Cedro 016. Se soportan separadores repetidos y líneas explícitas acotadas, sin dividir palabras dentro de nombres. | Los dos transcriptos históricos recuperan los ocho campos. Se mantienen las pruebas negativas de fecha, moneda y totales ambiguos. |
| P1 | El primario confundió cabeceras con el proveedor y sustituyó una palabra del concepto. Se precisan las instrucciones de identidad explícita y copia literal; ante conflicto o ilegibilidad debe advertir. Configuración nueva `invoice-json-v4-supplier-role-20261017`. | Cambio implementado; su eficacia necesita una corrida nueva. La regresión conserva las salidas primarias anteriores y sus tres discrepancias. |
| P2 | HTTP 400 podía envolver un error transitorio tipado y terminar el trabajo. Ahora el código o `metadata.error_type` transitorio permite respaldo acotado y recuperación durable; la prosa del error solo informa el diagnóstico. | Pruebas de extracción y Qwen; integración D1 de `RETRY` sin reserva a `DONE` con una única reserva, reutilizando la conversión secundaria. |

Se conservan los límites existentes de intentos y tiempo, las advertencias del modelo, la política vigente y los triggers de reserva atómica. El cambio de versión invalida artefactos de lectura anteriores. No se modifica el historial financiero.

La recuperación de errores sigue el campo tipado descrito por [OpenRouter](https://github.com/OpenRouterTeam/docs/blob/main/api_reference/errors-and-debugging.mdx). Las capturas de PDF usan la [API de conversión de Cloudflare](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/usage/rest-api/) con `pdf.metadata=false`, igual que el Worker.

## Resultado de la regresión

El [consolidado verificable](company-journeys-fixes-20261017.json) identifica los archivos fuente y sus hashes. Los tres recorridos usan empresas nuevas en D1/R2 local, API autenticada, consumidor original de cola y reservas mediante triggers. La cola tiene transporte controlado; las revisiones humanas son simuladas.

| Medida | Corrida original auditada | Repetición con correcciones |
| --- | --- | --- |
| Documentos intentados | 60 | 60 |
| Decisiones producidas | 56 | 56 |
| Recorridos completos correctos | 27 | 50 |
| Aprobaciones indebidas observadas | 1 | 0 |
| Decisiones autónomas correctas | 17 | 36 |
| Revisiones humanas simuladas | 4 | 5 |
| Replays de upload y procesamiento sin efectos duplicados | 60 de cada tipo | 60 de cada tipo |

Las respuestas del modelo primario y los transcriptos Qwen están congelados. Se recalculan únicamente las comparaciones derivadas por el servidor; todas las advertencias propias del modelo se conservan. Las capturas PDF son nuevas porque la corrida original no almacenó el texto convertido. No se hicieron nuevas llamadas a modelos de extracción ni OCR en esta repetición. Los reportes originales, manifests y documentos se conservaron.

Los resultados por empresa son Brisa 17/20, Cedro 17/20 y Lumen 16/20. Las 21 autorizaciones finales de la repetición también se comprobaron contra campos esperados, antecedentes y reservas: ninguna repite identidad ni reserva. Cero casos observados no demuestra ausencia universal de fallos.

## Verificación local

Pasan 277 pruebas: API 128, dominio 79, extracción 28, contratos 28 y D1 14. También pasa la prueba del Worker empaquetado en workerd. Pasan typecheck de dominio y extracción, `git diff --check` y el empaquetado del Worker con `wrangler deploy --dry-run`. Estas comprobaciones no son métricas del extractor. El frontend conserva su trabajo concurrente y no se ha desplegado esta candidata.

Para reproducir cada empresa sin llamadas a modelos:

```sh
cd apps/api
node scripts/evaluate-company-journey.mjs --reparse --company=brisa --source=../../docs/evaluations/company-journey-brisa-2026-10-17T22-01-40-441Z.json
node scripts/evaluate-company-journey.mjs --reparse --company=cedro --source=../../docs/evaluations/company-journey-cedro-2026-10-17T22-01-30-431Z.json
node scripts/evaluate-company-journey.mjs --reparse --company=lumen --source=../../docs/evaluations/company-journey-lumen-2026-10-17T22-01-57-433Z.json
```

El modo `--replay` repite la lectura completa intacta; `--reparse` ejecuta el lector actual sobre salidas primarias congeladas y texto independiente capturado. Ninguno equivale a una corrida nueva de modelos.

Una [comprobación adicional simultánea](priority-fixes-parallel-instability-20261017.json) falló al conectar con Miniflare local (`ETIMEDOUT` a `127.0.0.1`) y produjo errores del harness en los recorridos. Se conservaron los reportes fallidos y se repitió la verificación final de forma secuencial. El runner ahora comprueba que cada mensaje de cola pertenece al escenario activo y se detiene ante el primer error del harness, evitando contaminar los siguientes casos. Los fallos de lectores registrados por el producto siguen contándose y permiten continuar el recorrido.

## Pendientes para la siguiente medición

1. Lumen 003 y 006 confunden el nombre de cabecera con el proveedor explícito; Lumen 007 cambia una palabra del concepto. Los tres siguen en revisión segura en la regresión congelada. Medir la eficacia de las instrucciones nuevas del primario; no se reemplazaron sus valores por el acuerdo ni por el segundo lector.
2. Los cuatro HTTP 400 históricos permanecen como fallos: no guardaron la metadata tipada que permitiría reclasificarlos. La recuperación está comprobada en integración, pero falta observarla con respuestas reales de la candidata.
3. Tres casos 016 difieren del guion de presupuesto porque las abstenciones o fallas anteriores dejaron más saldo real. El motor usa ese saldo; no debe inventar reservas para coincidir con el guion.
4. Lumen 017 tiene fechas esperadas incorrectas en el manifest original: el documento dice emisión `2026-10-09` y vencimiento `2026-10-29`. Corregir la referencia en una versión nueva del dataset antes de medir exactitud; mantener intacta la evidencia histórica.
5. Publicar una candidata identificable y ejecutar una muestra nueva revisada, con lectores reales y verificación de navegador, antes de sostener la meta de 95.
