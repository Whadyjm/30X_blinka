# Candidata final de Oli

La nueva muestra Ronda produjo **20/20 decisiones completas correctas**, ocho normales automáticas, dos revisiones humanas y **cero aprobaciones indebidas observadas**. El control adicional del duplicado con antecedente sin resolver escaló sin solicitud de aprobación ni reserva. Todos los datos son ficticios y las autorizaciones son simuladas.

## Evidencia de cierre

| Medida | Resultado | Alcance |
| --- | --- | --- |
| Decisiones completas correctas | 20/20 | Lectores reales, HTTP, cola, D1 y R2 de producción; empresa nueva |
| Aprobaciones indebidas observadas | 0 | Nueve autorizaciones finales verificadas contra datos, política, antecedentes y reserva |
| Normales automáticas correctas | 8/8 | Ocho campos equivalentes según las reglas existentes; sin advertencias |
| Autonomía correcta | 15/20, 75% | Aprobaciones y bloqueos iniciales correctos; no incluye decisiones humanas |
| Decisiones con explicación y rastro | 20/20 | También se verificó su presentación desde navegador |
| Revisiones OWNER simuladas | 2 | Una aprobación y un rechazo desde navegador; replays sin efectos adicionales |
| Aprobación con política obsoleta | Rechazada | Revalidación posterior contra la nueva versión antes de autorizar |
| Replays de subida y procesamiento | 20 de cada tipo | Conservan resultado y reserva única |
| Original privado e íntegro | 20/20 | Bytes coinciden con SHA previo; acceso anónimo denegado |
| Fallos técnicos de lectura | 0 | Dentro de esta corrida final |
| Reserva final | USD 1.085, nueve reservas | No son transferencias bancarias |
| Duplicado adicional P0 | Escalado, cero reserva | Fuera del denominador de veinte; sin excepción humana genérica |

Los resultados originales están en [la corrida Ronda](candidate-ronda-live-2026-10-17T23-57-09-830Z.json). Su [manifest previo](ronda-prelive-freeze-20261017.json) fija los documentos y objetivos antes de la primera lectura. No se modificaron documentos, expectativas ni prompts a partir de sus resultados. El código cargado por el runner se conserva en [una copia identificada por hash](runners/candidate-ronda-v5-20261017.mjs).

La exactitud literal de los ocho campos fue 16/20 y la equivalencia según la política fue 17/20. Las incertidumbres esperadas permanecen en revisión: **20 decisiones correctas no significa veinte lecturas perfectas**. Las nueve autorizaciones finales sí tienen los ocho campos equivalentes, sin advertencias. La equivalencia conserva la normalización preexistente de nombres, conceptos y números de factura; importes, moneda y fechas se comparan exactamente.

## Versión y publicación concurrente

La medición comenzó en `c2ebd8b8-e2b7-4316-8904-df56ac40591d`. Durante el recorrido se publicó `049fcd19-54c4-41c2-8e81-e9dccbb76182`, que agregó únicamente `GET /api/v1/mandate/versions`, una consulta autenticada con filtro por organización.

El guard del runner detectó el cambio de bytes y dejó su error intacto. La [auditoría posterior](ronda-concurrent-deployment-audit-20261017.json) demuestra que solo cambió una línea del bundle para añadir esa consulta: todos los demás bytes, incluidos lectores, autorización, presupuesto y reservas, son idénticos. Los 134 contenidos del source map también coincidían, aunque el mapa no incorporaba esa adición manual. Se reconstruyó el fuente del endpoint ya publicado y se regeneró el mapa al publicar la evidencia final. No se repitieron lecturas para resolver este cambio de versión.

El [manifest de publicación vigente](candidate-release-20261017.json) identifica la versión, el hash del bundle y el commit con los 28 archivos del backend. El commit de fuente completo es `2ae21aba53dcdc80d18e1fac9d2feac0cb1c2b8a`. La publicación de métricas modifica únicamente el artefacto de evaluación respecto del comportamiento publicado y conserva la interfaz concurrente.

## Corrección de disponibilidad PDF

El diagnóstico privado confirmó que los tres modelos anteriores seguían pasando por el mismo parser de PDF saturado. El backoff y cambiar de LLM no eliminaban esa dependencia. El lector actual envía los bytes originales a Gemini mediante `engine: native` y mantiene la lectura separada PDF_TEXT de Cloudflare. No usa la salida de Cloudflare como entrada primaria.

La configuración es `labelled-v7:invoice-json-v5-native-pdf-20261017:qwen-image-transcript-v2-20261017`. El [catálogo consultado](native-pdf-model-catalog-20261017.json) verifica soporte de archivos y salida estructurada; la [documentación de OpenRouter](https://openrouter.ai/docs/guides/overview/multimodal/pdfs) describe el procesamiento nativo. Los cinco [controles documentales reales](native-pdf-critical-readers-20261017.json), tres PDF y dos imágenes, pasaron antes de iniciar Ronda. Incluyen el PDF que había agotado sus intentos y una nota de entrega que debía rechazarse como factura.

Verificación local: API **136/136**, extracción **30/30**, typecheck y Worker empaquetado **1/1** en workerd. La proyección de las métricas finales pasa su comprobación de origen y contadores. Estas pruebas locales no se suman a los documentos medidos ni son métricas OCR.

## Corridas anteriores y límites

La [primera corrida Marena](marena-first-live-audit-20261017.json) conserva 16/20 recorridos correctos y tres fallos técnicos. [Selva](selva-stopped-audit-20261017.json) se detuvo después de dos fallos terminales que hacían imposible el mínimo 19/20: doce filas completas, diez correctas, trece documentos subidos y siete sin ejecutar. Los casos no ejecutados no se presentan como éxitos. Ambas muestras pasan a ser regresiones después de usarlas para corregir el sistema; no se borraron sus errores.

Ronda fue la última muestra adicional predeclarada. Usa familias de formatos etiquetados soportados; no demuestra lectura universal ni validación completa de líneas, impuestos o PDF extensos. Cero aprobaciones indebidas observadas no prueba ausencia universal de errores. El cierre conserva la abstención ante discrepancias y los límites de intentos; nunca autoriza por agotamiento de un proveedor.
