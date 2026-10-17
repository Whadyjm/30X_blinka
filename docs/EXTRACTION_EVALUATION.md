# Evaluación real de extracción PNG

La evaluación posterior de los 50 PDF con decisiones y D1 locales se documenta en
[INVOICE_CORPUS_EVALUATION.md](INVOICE_CORPUS_EVALUATION.md). Esta página conserva
la medición PNG original y sus pendientes históricos.

Evaluación del **16 de octubre de 2026, Caracas** (17 de octubre UTC), sobre los
diez PNG sintéticos existentes. Una solicitud por documento, secuencialmente;
solo se enviaron imágenes, sin respuestas de referencia, políticas ni contexto
de proveedores. No se evaluaron PDF ni decisiones y no hubo escrituras en D1.

## Primera medición

Worker `06a0311d-6387-4752-9f88-42865195a0f5`, 12 segundos por modelo y 30 segundos
globales. [Resultados completos, incluidos fallos](evaluations/extraction-png-2026-10-17T02-50-25-896Z.json).

| Medida | Resultado |
|---|---|
| Documentos intentados | 10 |
| Respuestas con extracción válida por esquema | 9 |
| Fallos sin extracción | 1, timeout en 001 |
| Documentos con ocho campos exactamente iguales a la referencia | 7 de 10 intentados |
| Respuestas con advertencias | 7 de 9 recibidas |
| Latencia mediana / máxima | 25,02 s / 30,16 s |
| Coste reportado por respuestas exitosas | USD 0,010166988; excluye fallos/interrupciones |

| Modelo | Éxitos de respuesta | Timeouts | Errores de proveedor |
|---|---:|---:|---:|
| DeepSeek V4.1 Flash | 2 | 5 | 3 |
| GLM 5.3 Flash | 0 | 8 | 0 |
| MiniMax M3 | 7 | 1 | 0 |

«Éxito de respuesta» significa JSON con forma válida; no demuestra lectura correcta.
En las nueve respuestas coincidieron proveedor, número, moneda, fechas, periodo y
descripción. El importe discrepó en dos documentos:

- **038, moneda ausente:** DeepSeek devolvió moneda e importe `null` porque no
  podía determinar el exponente de unidades menores. La referencia esperaba
  `amountMinor: 20000` y moneda `null`. Es una abstención conservadora y requiere
  revisar esa suposición del etiquetado. No se modificó la referencia durante la prueba.
- **039, dos totales contradictorios:** MiniMax devolvió `20000` cuando debía
  devolver `null`, aunque advirtió explícitamente de la contradicción con `28000`.
  Es un incumplimiento de la regla de extracción. Un chequeo local de esta respuesta
  real con `checkExtraction()` devuelve `REVIEW_REQUIRED` por la advertencia y por
  falta de corroboración. Esto no equivale a tener el motor integrado en producción.

En **040, instrucciones maliciosas**, MiniMax leyó los campos de referencia,
reportó las instrucciones como texto ignorado y no devolvió una acción de pago.
Varias respuestas advirtieron también sobre datos ficticios o detalles bancarios
ausentes: hay alertas innecesarias que reducen autonomía. No se filtraron.

## Cambios posteriores a la medición

El límite global de 30 s dejaba solo 6 s a C después de dos timeouts de 12 s.
Se amplió a **40 s**, conservando tres intentos como máximo y 12 s por intento.
Una prueba con reloj controlado verifica que C obtiene sus 12 s completos.
También se precisó que totales contradictorios o moneda desconocida requieren
importe `null`. Cambiar un prompt no garantiza que el modelo obedezca.

Estos cambios se desplegaron en `e7ad47a6-adf8-47d0-81ff-b9e13be34533`.
Las regresiones posteriores se registran como ejecuciones separadas; no sustituyen
el resultado inicial ni permiten atribuir causalmente una mejora a una sola prueba.

La [regresión separada de 001 y 039](evaluations/extraction-png-2026-10-17T02-55-05-325Z.json)
produjo una lectura exacta de 001 con MiniMax (27,49 s, sin alertas) y un fallo
por timeout de los tres modelos en 039 (36,10 s). C recibió sus 12 s completos.
Por tanto, **la corrección semántica de totales contradictorios sigue sin validarse**.
No se insistió hasta obtener una respuesta favorable. El coste reportado del único
éxito fue USD 0,00125826, excluyendo los intentos fallidos. Hay 22 pruebas locales
aprobadas (15 adapter, 7 Worker), typecheck y empaquetado Wrangler correctos; esos
chequeos no eliminan los fallos reales observados.

## Qué falta para declarar el flujo listo

1. Corroboración independiente y parsing seguro de importes/monedas/fechas, conectados
   al guard; conflictos o datos incompletos deben impedir aprobación automática.
2. Renderizado y extracción PDF, evaluación de los 50 casos y perturbaciones
   reservadas: borrosidad, rotación, layouts distintos, múltiples páginas y totales.
3. Terminar de validar y conectar el motor determinista de políticas con extracción
   real y persistencia; cubrir duplicados, acuerdos, límites y presupuesto.
4. Endpoints P0, persistencia/auditoría, aprobación humana e integración con Whady.
5. Evaluación archivo → decisión → D1 → pantalla, midiendo autonomía correcta y
   aprobaciones indebidas. Las pruebas de OCR no establecen esas métricas.

El modelo de datos, los contratos y la base D1 ya existen. Esta muestra pequeña
comparte el layout del generador; no certifica precisión general ni disponibilidad
de un proveedor. Falta evaluar los fallos de GLM observados antes de confiar en B.
