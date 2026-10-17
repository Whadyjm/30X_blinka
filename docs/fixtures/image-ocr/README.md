# Imágenes ficticias para corroboración OCR

Quince PNG generados por `apps/api/scripts/generate-image-ocr.py`, con Pillow 11.3.0 y fuentes
incluidas. `manifest.json` fija hashes, campos esperados y casos que exigen revisión. La máscara
de importe y la de proveedor se inspeccionaron antes de iniciar las lecturas de estos casos.
Las etiquetas no se envían a los lectores.

Incluye texto claro, rotación, separadores de miles/decimales, moneda ausente o contradictoria,
dos totales, importe o proveedor cubiertos, nota de entrega, instrucciones incrustadas, subtotal
sin total final y vencimiento ambiguo o ausente. Las expectativas de acción se refieren a la
política demo USD y a un directorio/acuerdos ficticios compatibles; no configuran producción.
Un bloqueo financiero esperado puede requerir primero revisión si la lectura no es concluyente.

Regenerar: `python3 apps/api/scripts/generate-image-ocr.py`. Verificar sin escribir:
`python3 apps/api/scripts/generate-image-ocr.py --check`. Esto valida los fixtures, no el OCR.

`node apps/api/scripts/evaluate-image-readers.mjs --run` mide estos quince casos, diez PNG
originales y dos imágenes del conjunto adicional. Es una prueba explícita de lectores remotos:
máximo 108 llamadas, secuencial, sin escrituras financieras. Compara por separado el gate real
en sombra y el gate hipotético habilitado. Usa la credencial privada del probe internamente.
Tras emplear estos documentos para ajustar código, las corridas son regresión, no un conjunto
reservado nuevo. El coste y la precisión universal no se deducen de esta muestra.

`documents/canary-001.jpg` es una conversión adicional de001.png a JPEG (Pillow11.3.0,
calidad85) para una prueba puntual de subida y cola en producción. Su hash y resultado están
en `docs/evaluations/image-ocr-production-canary-20261017.json`; no se cuenta entre los quince PNG
ni entre las27lecturas de la evaluación comparativa.
