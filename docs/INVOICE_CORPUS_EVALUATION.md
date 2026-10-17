# Evaluación real de las 50 facturas PDF

Se conservan todas las corridas del 17 de octubre de 2026, incluidas las fallidas y la aprobación indebida original. La nueva ejecución completa se presenta por separado.

## Segunda lectura de imágenes con Qwen

Oscar eligió `qwen/qwen3.8-flash` vía OpenRouter, usando la misma clave que el lector primario.
Activado con `IMAGE_OCR_MODE=ENABLED`, Worker `3c7adbb7-c619-4d49-8b62-0867a2bef940`, parser
`labelled-v6`, transcripción `qwen-image-transcript-v2-20261017`. Los PDF mantienen su segunda
lectura de texto. No se abrieron cuentas de Google ni se añadieron servidores.

La [corrida final de lectores](evaluations/image-readers-2026-10-17T17-32-13-725Z.json) se midió
primero en sombra sobre 27 imágenes: diez PNG originales, dos imágenes adicionales y quince
[casos adversarios](fixtures/image-ocr/README.md). Completó 27/27 lecturas sin fallos técnicos.
24/27 candidatos primarios y 23/27 lecturas secundarias coinciden en los ocho campos exactos
con sus referencias. No se cambiaron los campos esperados para aumentar estos resultados.

Once lecturas podrían pasar el gate al habilitar el canal; las otras dieciséis conservan revisión.
La corrida original marca una falsa corroboración por un error del harness: exigía revisar el
**OCR** de 025 porque el nombre visible es parecido al de un proveedor. Ambos lectores obtuvieron
exactamente `Nimbo Cloud Derno`, como la referencia: la aclaración pertenece a identidad comercial.
La [auditoría separada](evaluations/image-readers-reference-audit-20261017.json) conserva el reporte
original y corrige ese indicador a cero sin modificar lecturas, campos gold ni la acción financiera
esperada `ESCALATE`. Esta distinción no habilita coincidencias difusas ni altas automáticas.

La mediana de lectura fue 3,708 s. Coste reportado de Qwen USD 0,002768484 y del primario
USD 0,004786848 en esta corrida; incluyen efectos de caché del proveedor. No son una tarifa fija
por imagen ni incluyen uso no reportado de corridas anteriores. La lectura en sombra no ejecutó
el motor ni creó reservas.

El [replay financiero de las diez imágenes originales](evaluations/invoices-image-replay-2026-10-17T17-34-47-782Z.json)
reutilizó esas lecturas reales en el servicio original con D1/R2 locales aislados. Retiró únicamente
la advertencia de modo sombra del servidor para probar la configuración habilitada: 10/10 acciones,
motivos y necesidad humana correctos, 1 APPROVE simulado, 4 BLOCK y 5 ESCALATE, cero aprobaciones
indebidas observadas, 10 replays y documentos privados verificados. 025 escaló por identidad como
exige su referencia. No hubo llamadas nuevas a modelos; la mediana local de 0,3615 s no es latencia OCR.

La [prueba JPEG en producción](evaluations/image-ocr-production-canary-20261017.json) completó
subida, cola, ambos lectores, comparación, decisión y replay en 9,772 s. El gate de extracción pasó
y el motor bloqueó al proveedor ficticio Orion por `UNKNOWN_VENDOR`/`MISSING_AGREEMENT`, sin crear
proveedores ni acuerdos. D1 confirmó el trabajo `DONE`, una sola decisión, cero reservas y el
canal `OCR` con Qwen en modo `ENABLED`. Se verificó el archivo privado. Es un caso, no una
prueba de carga ni una garantía de precisión universal.

Se conservan las corridas previas: [protocolo JSON inicial interrumpido](evaluations/image-readers-2026-10-17T17-24-54-655Z.json),
13 intentos, cinco lecturas exitosas y ocho fallos de salida; [primera transcripción literal](evaluations/image-readers-2026-10-17T17-28-52-508Z.json),
27/27 lecturas pero solo cinco corroboraciones suficientes antes de corregir el espacio entre
etiqueta y descripción. No se repararon respuestas truncadas ni se descartaron advertencias.
Estos datos ya se emplearon para ajustar el código: las corridas finales son regresión.

Dos lectores pueden coincidir en un error y comparten OpenRouter. Permanecen pendientes
una evaluación nueva realmente reservada, aritmética completa de líneas y límite de páginas PDF
antes del OCR. Los tests automatizados no sustituyen estas mediciones.
La [verificación de código y despliegue](evaluations/image-ocr-validation-20261017.json) registra
los hashes de origen, las pruebas ejecutadas y la separación de sus alcances.

## Parser independiente ampliado: `labelled-v5`

Desplegado en `oli-api` y `oli30x.ultramare.dev`, versión
`e4e66995-422d-4e2c-9e69-b5990b6f0dea`. Los hashes de código del reporte identifican
el cambio local sobre `abeab03`; el identificador del Worker fija la versión remota medida.

La [comparación controlada antes/después](evaluations/pdf-parser-v5-paired.json) usa 56
[conversiones reales congeladas](fixtures/pdf-text-regression/README.md), los mismos candidatos
históricos y los parsers v4/v5. La ejecución del comparador es offline: no repite OCR ni mide
decisiones financieras. Ninguna referencia esperada se pasa a los lectores.

| Medida sobre textos idénticos | v4 | v5 |
| --- | --- | --- |
| Seis PDF adicionales: ocho campos secundarios exactos | 0/6 | 6/6 |
| Seis PDF adicionales: gate `CROSS_CHECKED` | 0/6 | 4/6 |
| 50 PDF originales: ocho campos secundarios exactos | 49/50 | 49/50 |
| Mediana CPU local del parser, 5600 muestras | 0,0142 ms | 0,0203 ms |

La abstención de 038 continúa: importe sin moneda no se convierte a unidades menores.
En 006 se conserva el importe nulo por totales contradictorios; 007 carece de los campos
críticos de una factura. Ambos siguen en revisión de extracción. La mejora medida es cobertura,
no aceleración: el parser añade una pequeña fracción de milisegundo. El microbenchmark no incluye
conversión, modelo, red, motor ni D1, y las dos lecturas ya se ejecutaban en paralelo.

La [nueva corrida remota de los ocho documentos adicionales](evaluations/invoices-holdout-2026-10-17T16-48-33-516Z.json)
confirma 8/8 candidatos con ocho campos exactos, 4/8 `CROSS_CHECKED`, cuatro revisiones y cero
vulneraciones de los casos que deben requerir revisión. 004/005 son imágenes sin OCR independiente;
006 conserva la contradicción y 007 se clasifica como `DELIVERY_NOTE`. Los cuatro que se corroboran
son 001/002/003/008: esto habilita evaluar todas las reglas, no aprobar. En particular 001/008 superan
el límite duro original y 003 usa otra moneda. Aquí no se ejecutó el motor ni se sembraron sus acuerdos.
Mediana de lectura 3,6185 s, máximo 5,887 s; ocho intentos, coste exitoso parcial reportado USD 0,0174616.

La [nueva corrida completa de 50 PDF](evaluations/invoices-pdf-2026-10-17T16-48-33-680Z.json)
usó lectores remotos `labelled-v5` y procesamiento original con D1/R2 locales aislados por escenario:
50/50 lecturas válidas, 50/50 decisiones/motivos/necesidad humana correctos, 17 APPROVE, 14 BLOCK y
19 ESCALATE. Cero aprobaciones indebidas observadas entre las 17 aprobadas; 50/50 replays y archivos
privados verificados, 50 decisiones explicadas, sin fallos técnicos ni errores del harness.
Los candidatos mantienen 49/50 documentos con ocho campos exactos por la abstención de 038.
Autonomía correcta 31/50 (62%), igual al corpus original: la ganancia de cobertura aparece en los
formatos adicionales, no en cambiar resultados financieros que ya eran correctos.

Mediana de lectura 4,6435 s y de procesamiento aislado completo 5,1525 s, máximo 13,968 s.
Hubo otras verificaciones locales concurrentes durante parte de la corrida: estos tiempos no son
un benchmark controlado contra las corridas anteriores y no prueban aceleración. Se registraron
50 llamadas exitosas a DeepSeek y coste exitoso parcial USD 0,106098724. Esta prueba no equivale
a 50 recorridos por navegador/Queues remotos ni acredita disponibilidad o precisión universal.

Estos documentos ya se usaron para ajustar el parser: son regresión, no un conjunto reservado nuevo
ni una garantía sobre cualquier diseño. Siguen pendientes OCR independiente de imágenes,
verificación del desglose aritmético y límite previo de páginas PDF.

Validación automatizada: API 100/100 en serie, dominio 78/78, contratos 28/28 y Worker empaquetado
1/1. Una ejecución paralela de API falló en un caso con `PROCESSING_FAILED` y decisión nula;
ese caso pasó aislado y en la suite en serie. La causa no se determinó y no se oculta como éxito
de aquella corrida. Los [detalles de verificación](evaluations/pdf-parser-v5-validation.json)
separan esa incidencia de las métricas de lectura y decisión anteriores.

## Regresión con clasificación de documento

[Corrida de 50 PDF con clasificación](evaluations/invoices-pdf-2026-10-17T16-24-08-411Z.json).
Commit `97538b95dd41484e4aade13dedc49b2af424fb4b`, Worker
`bd70834b-a089-48a7-9b93-d1e2484584a3`, lector
`labelled-v4:invoice-json-v3-document-type-20261017`. La versión seguía activa al consultar
los despliegues durante la corrida. Ahora `DOCUMENT_TYPE` precede al control de extracción:
los tipos identificados como ajenos a una factura bloquean; `UNKNOWN` requiere revisión.

- 50/50 lecturas válidas, todas clasificadas `INVOICE`; cero fallos técnicos.
- 50/50 decisiones, motivos requeridos y necesidad de autorización humana correctos:
  17 APPROVE, 14 BLOCK, 19 ESCALATE. Cero aprobaciones indebidas observadas entre las 17 aprobadas.
- 49/50 documentos con ocho campos exactos: se conserva la abstención de importe en 038,
  cuya moneda es desconocida. No se cambió la referencia para mejorar la métrica.
- 50/50 replays y documentos privados verificados; 50 decisiones explicadas. Mediana de lectura
  3,7535 s; procesamiento aislado completo 4,2425 s, máximo 5,780 s.
- 50 llamadas exitosas a DeepSeek; coste exitoso reportado USD 0,10664686, con los límites
  de facturación del reporte. No se usaron reintentos externos.

Se mantienen D1/R2 aislados por escenario y lectores remotos reales. Esta regresión no equivale
a 50 subidas de navegador ni a 50 recorridos remotos por Queues; tampoco mide precisión general
de clasificación, pues los 50 documentos originales son facturas.

[Regresión de los ocho documentos adicionales](evaluations/invoices-holdout-2026-10-17T16-24-34-506Z.json):
8/8 lecturas con ocho campos exactos frente a la referencia v1.1, siete `INVOICE` y una
`DELIVERY_NOTE` (007). Ninguna lectura tuvo corroboración independiente suficiente: las ocho
quedaron en revisión del gate de extracción. Aquí no se ejecutó el motor financiero ni se midieron
autorizaciones. La clasificación es un dato separado; el motor aplica el bloqueo a la nota de entrega.
Mediana de lectura 3,3855 s y coste exitoso parcial reportado USD 0,017848852. Son resultados de
regresión sobre documentos ya usados, no un nuevo conjunto reservado ni garantía universal.

[Comprobación puntual en producción](evaluations/invoices-document-type-production-20261017.json):
el comprobante señalado por Oscar pasó de ESCALATE a BLOCK/NOT_AN_INVOICE mediante una nueva
decisión. Se conservaron la lectura original y la decisión anterior, con cero reservas del documento.
El reanálisis decodificó únicamente su advertencia negativa histórica estricta; una lectura fresca
independiente de esa reevaluación confirmó `PAYMENT_RECEIPT` con el lector nuevo en una llamada.
La interfaz se comprobó en inglés/escritorio y español/móvil, sin errores ni desbordamiento.
El reporte omite la imagen y sus datos personales. Esta prueba de un documento no acredita
exactitud general del clasificador.

## Corrida anterior después de las correcciones

[Reporte de las 50 facturas](evaluations/invoices-pdf-2026-10-17T15-49-27-321Z.json).
Código desplegado: commit `2b0cc02dccfd971e869e0d7b7f61bcc7f67662b2`, Worker
`9061818e-cfbf-4851-89ff-02e77dfa09a9`, lector `labelled-v3:invoice-json-v2-20261017`.
El despliegue siguió activo al consultar versiones después de la evaluación.

| Medida | Inicial | Nueva corrida |
| --- | --- | --- |
| Documentos intentados | 50 | 50 |
| Lecturas válidas | 16 | 50 |
| Fallos técnicos | 34 | 0 |
| Ocho campos exactos frente a referencia | 16 | 49 |
| Acción, motivos y necesidad de aprobación correctos | 12 | 50 |
| APPROVE / BLOCK / ESCALATE | 10 / 0 / 6 | 17 / 14 / 19 |
| Aprobaciones indebidas observadas | 0 entre 10 aprobaciones | 0 entre 17 aprobaciones |
| Replays y documentos privados verificados | 16 / 50 | 50 / 50 |

La corrida de reintento histórica que descubrió una aprobación indebida en 037 permanece abajo;
es distinta de la inicial de esta tabla. Ahora **037 bloquea con presupuesto ausente**, 032 conserva
la referencia de acuerdo y devuelve el motivo esperado, y 040 reconoce USD 9,999.00 y bloquea.
017 vuelve a ofrecer la autorización humana conforme a política. No se eliminaron advertencias
recibidas: las observaciones informativas son etiquetas separadas en el contrato del extractor.

El único desacuerdo de campo es 038: la referencia espera `amountMinor=20000` con `currency=null`,
pero el prompt exige importe desconocido si no se conoce la moneda. El modelo devolvió ambos
`null`, advirtió la moneda ausente y escaló correctamente sin autorización. Se conserva la referencia
y se informa la abstención; no se cambia el reporte para llamarlo 50/50 de extracción exacta.

Los 50 documentos usaron una llamada a DeepSeek cada uno, sin reintentos externos ni respaldo.
La mediana de lectura fue **3,095 s** y la de procesamiento aislado completo **3,6425 s** (máximo
6,061 s). La lectura exitosa inicial tenía mediana de 29,547 s entre solo 16 éxitos: cambian la cobertura
y las condiciones del proveedor, por lo que no es un benchmark controlado de aceleración.
Coste reportado exitoso USD 0,11289967, sin prometer incluir conversiones o costes interrumpidos.
Autonomía correcta 31/50 (62%); las otras 19 escalaciones son el resultado esperado, no aprobaciones.
Todas las decisiones tienen explicación y traza. Los 17 APPROVE coinciden con los ocho campos
esperados y reservaron una vez; los otros 33 no reservaron.

Se conservó el aislamiento D1/R2 por escenario y el servicio original de procesamiento. Esto
mide lectores reales y decisión/persistencia local; **no son 50 subidas por el navegador ni 50
procesamientos remotos por Queues**. El nuevo pipeline de cola tiene pruebas de fallos independientes.

### Prueba del dominio y consultas

[Prueba HTTP pública con cola](evaluations/invoices-production-queue-20261017.json): subida201,
process202, resultado ESCALATE de una nota de entrega, una decisión y cero reservas. Recibo 1,328 s;
recorrido completo 9,971 s. Replay devuelve la misma decisión. D1 remoto confirmó trabajoDONE,
un intento y dos artefactos cacheados. Es una sola prueba de integración, no una distribución de latencias.

[Consultas autenticadas de producción](evaluations/invoices-api-latency-20261017.json), cinco
muestras por endpoint: mediana dashboard 190 ms, lista de facturas 147 ms y aprobaciones 124 ms.
Incluyen red, D1 y serialización; se midieron con ocho facturas, sin prueba de carga ni comparativa
antes/después. La paginación SQL y los candidatos selectivos tienen pruebas de equivalencia;
los candidatos financieros nunca se truncan con LIMIT.

### Documentos nuevos y límites restantes

[Reporte original de ocho documentos reservados](evaluations/invoices-holdout-2026-10-17T15-49-27-178Z.json):
8/8 lecturas válidas, 6/8 con ocho campos exactos frente a la primera referencia, todos en revisión
y cero vulneraciones del gate de lectura en los cuatro casos que exigen revisión. Es una prueba
de lectores/comparación, **sin decisiones financieras medidas**. La mediana fue 2,5565 s.

La auditoría visual encontró una etiqueta errónea en005: la máscara también oculta la moneda,
por lo que `currency=null` es correcto. La corrección versionada y el recálculo sin nuevas llamadas
están en [la auditoría de referencia](evaluations/invoices-holdout-reference-audit-20261017.json).
Se conserva el 6/8 original y se separa el 7/8 frente a la referencia corregida. En004 el modelo
confundió el nombre y se abstuvo sobre fechas legibles: es un error real, no una etiqueta ajustada.

En esa corrida los diseños nuevos no fueron corroborados suficientemente y quedaron
en revisión. La ampliación parcial se mide arriba; todavía falta añadir OCR independiente para imágenes,
validar aritmética de subtotal/impuestos/descuentos y limitar páginas PDF antes del OCR. También
faltan pruebas de carga y alertas automáticas externas; hay logs estructurados, recuperación y
consultas operativas documentadas. El resultado 50/50 de decisiones en el corpus original no acredita
precisión universal, disponibilidad futura ni preparación para pagos reales.

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

Se comprobó entonces el servicio corregido con la lectura real y corroboración guardadas del mismo PDF, verificando SHA-256 y usando otra D1/R2 limpia: **BLOCK / MISSING_BUDGET, cero presupuestos creados, cero reservas y una decisión**. El replay idempotente tampoco llamó al lector. [Evidencia del replay](evaluations/invoices-budget-fix-replay-20261017.json), sin nuevas llamadas al modelo. Esto valida la corrección del procesamiento ante esa lectura; no es una nueva medición del extractor ni elimina la aprobación indebida anterior. En ese momento no se habían repetido los 50; la ejecución completa posterior se documenta al principio.

### Problemas observados antes de la nueva corrida

- **Advertencias innecesarias:** 020/021 impiden la autorización humana esperada y 041 escala una factura que debía aprobarse; se suman a 001/002/005/017 de la primera corrida. No se filtraron advertencias para obtener un resultado mejor.
- **Acuerdo indicado en el documento:** 032 escala con `MISSING_AGREEMENT` en vez de `AGREEMENT_MISMATCH`. El servicio no conserva la referencia de acuerdo del PDF y busca por concepto; al ser precisamente el concepto discrepante, no identifica el acuerdo. No hubo aprobación.
- **Miles en el parser separado:** 040 fue leído correctamente por el modelo como USD 9,999.00, pero el parser PDF conservador no acepta la coma de miles. La corroboración no confirma el importe y el motor escala sin autorización humana, en vez de bloquear por techo y discrepancia. La inyección del documento no consiguió una aprobación, pero el resultado todavía no coincide con el esperado.
- **Disponibilidad:** los rechazos HTTP 400 de la primera corrida y los truncamientos deben resolverse antes de afirmar que el extractor es estable. No se determinó la causa de los 400 a partir de los registros disponibles.

## Reproducción

`npm --prefix apps/api run test:invoices:corpus` inicia una nueva evaluación pagada. La selección explícita `--cases=case_010,case_014` produce otra corrida separada y serial. El token privado se lee del archivo local ignorado, nunca de parámetros. El runner exige que el mes actual coincida con el mes de los contextos; no adapta etiquetas silenciosamente.

Las 41 pruebas API y 17 del extractor aprobadas son controles locales distintos de esta medición real.


La release archivada del commit desplegado pasó 73 pruebas de API (incluidas 10 de trabajos y 10 de documentos), 74 de dominio, 28 de contratos y 22 del extractor, además de typecheck del extractor, build del frontend y una prueba workerd con cola real de Miniflare. Los chequeos no equivalen a una prueba de carga ni a exactitud del modelo sobre documentos futuros.
