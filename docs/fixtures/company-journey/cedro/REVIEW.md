# Cedro company journey: revisión del dataset

Dataset sintético para `company-journey-v1`, fijado antes de cualquier lectura remota. Solo contiene empresas, proveedores, importes y documentos ficticios; las fechas están en octubre de 2026 y las autorizaciones son simuladas.

## Contenido y controles previos

- 20 casos secuenciales en una única empresa: 12 PDF y 8 PNG/JPEG.
- 18 proveedores, 13 acuerdos ONE_TIME con conceptos únicos, y las reglas Cedro del contrato solicitado.
- Los veinte archivos tienen SHA-256 y tamaño registrados. El preflight verificó el contrato de claves, el MIME/decodificación de imágenes y los hashes.
- `011` es una copia byte a byte de `001`; `012` conserva proveedor y número de `001` pero cambia los bytes.
- Casos 001–008 reservan USD 800 en total. 009 escala por superar el límite automático y la acción humana simulada `APPROVE` añade USD 600. 010 escala y la acción `REJECT` no reserva. Por tanto, antes de 016 quedan USD 800; 016 solicita USD 900 (bajo el hard limit) y debe bloquearse por presupuesto.
- Los casos 013–020 aíslan proveedor no permitido, desacuerdo con el acuerdo, hard limit, presupuesto, moneda ausente, totales contradictorios y clasificación de recibo/cotización.
- Las etiquetas de las facturas usan campos reconocidos por `labelled-v6` en inglés o español. 017 deja importe y moneda desconocidos; 018 deja el importe desconocido por dos totales finales contradictorios. 019 no muestra moneda ni descripción de servicio y ambas referencias quedan `null`. La cotización 020 muestra USD 425, sin fingir un número de factura ni fecha de emisión.

## Alcance

La corrida y sus límites se documentan abajo. El preflight y self-test sintético no son métricas de OCR ni sustituyen la evaluación real.

## Contrato ejecutable

El manifiesto mantiene las claves canónicas de reglas aceptadas por `MandateRulesSchema` y marca `expectedDocumentType` en cada caso para que el harness pueda revisar la clasificación sintética antes de llamar lectores. Esa etiqueta es solo referencia del harness y no debe enviarse a ningún modelo.

## Corrida real única

Autorizada por el coordinador después de validar el parser y el self-test; resultados completos en `docs/evaluations/company-journey-cedro-2026-10-17T22-01-30-431Z.json`. El manifiesto permaneció sin cambios durante la corrida.

- 20 intentos secuenciales; 18 decisiones y 2 fallos de lector (`OPENROUTER_REQUEST_REJECTED`, HTTP 400 clasificado como `UPSTREAM_RATE_LIMIT`, casos 005 y 010).
- 10/20 resultados completamente correctos, 15/20 extracciones exactas en los ocho campos, 7 decisiones autónomas correctas y 18 explicaciones registradas. 19 divergencias de contexto presupuestario porque el importe esperado para la secuencia asumía reservas que no ocurrieron en casos anteriores.
- 4 aprobaciones, 4 bloqueos y 10 escalaciones; cero aprobaciones inseguras y cero aprobaciones inesperadas. La única revisión humana completada fue aprobar 009; 010 falló antes de llegar a la acción humana simulada.
- La reserva local terminó en 90.000 unidades menores (002, 004, 006 y 009). Así, 016 no llegó a probar el bloqueo por saldo: escaló por incertidumbre de extracción. No afirmar que se midió correctamente el escenario de presupuesto insuficiente.
- Los PDFs originales pasaron validación offline de `parsePdfText` contra las etiquetas antes de la llamada remota. La corrida real sí encontró desacuerdos entre lector primario y corroboración en varios casos normales; permanecieron en revisión y no se repararon las etiquetas.
- Se registraron USD 0,0228701 de costo primario y USD 0,00312438 secundario en respuestas exitosas. El runner advierte que fallos/interrupciones y conversiones separadas pueden no reportar costo; no es un total garantizado.

No repetir la corrida pagada ni ajustar manifiesto/generador a estos resultados. Las discrepancias de OCR y las referencias de acciones 005/010/012/014/015/016 requieren coordinación antes de cualquier nueva medición.
