# Extracción robusta y demostración en vivo

Fuente superior: [RETO_BLINKA.md](../master_files/RETO_BLINKA.md).
El objetivo es resolver correctamente facturas y **no aprobar fuera de las reglas**.
La extracción de documentos puede equivocarse; la arquitectura debe detectar incertidumbre
y permitir revisión/corrección antes de que se autorice algo con datos no corroborados.

## Actualización: revisión humana explícita y formatos reales (2026-10-18)

Oscar autorizó una confirmación humana explícita de facturas en revisión. El botón **APROBAR FACTURA** abre un
modal con advertencia, datos actuales del documento y una casilla de confirmación inicialmente desmarcada.
No se aprueba nada al abrir/cerrar el modal. El servidor identifica al revisor autenticado, exige la decisión y
política vigentes, conserva la extracción original y registra una atestación append-only separada. La
migración `0013_invoice_manual_reviews.sql` protege ese registro y acota la resolución de identidad de la factura.

`checkExtraction()` distingue `HUMAN_CONFIRMED` de `CROSS_CHECKED`: una persona puede confirmar los datos
existentes y aceptar las observaciones, pero esa atestación no se presenta como OCR ni habilita autonomía.
El navegador no envía una extracción ni un `verified: true`; el servidor vincula la revisión al hash, lectura,
usuario y extracción exactos. Datos críticos ausentes siguen requiriendo corrección. El tipo de documento debe
ser INVOICE. El motor vuelve a comprobar proveedores, acuerdos, fechas, duplicados, moneda, límites y presupuesto.
Solo una excepción de monto ya permitida por la política puede resolverse junto con esta autorización humana.
La reserva sigue exclusivamente en los triggers D1. No se altera una decisión histórica ni se ejecutan pagos.
Esta autorización explícita sustituye la prohibición anterior de confirmar manualmente incertidumbre de lectura;
la prohibición de **autoaprobar** incertidumbre permanece.

Para imágenes, Qwen sigue viendo únicamente los bytes originales en una llamada separada, sin el candidato ni
reglas de gasto. Ahora devuelve transcripción literal y campos identificados por su significado en el documento,
sin exigir etiquetas de nuestra plantilla. El servidor exige valores literales presentes en esa transcripción y
normaliza importes con BigInt, euros explícitos y fechas inequívocas. Un dato presente pero distinto se registra
como MISMATCH; un dato no interpretado como UNAVAILABLE. Ninguno de esos estados se convierte en autoaprobación.
Los roles emisor/cliente siguen siendo distintos: encontrar un nombre no acredita que sea quien cobra.

El parser de PDF `labelled-v8` reconoce Emisor/Vendedor/Facturado por, Número de factura, Fecha de factura,
Fecha de emisión y Fecha de vencimiento; admite € y fechas locales solo si el orden día/mes es inequívoco.
`03/04/2026` sin formato explícito sigue siendo incierta. El protocolo Qwen es `qwen-image-fields-v3-20261018`
y su límite pasa de 12 a 20 segundos; la medición inicial del protocolo estructurado tuvo dos timeouts a 12 s.
La versión nueva invalida cachés anteriores. JSON válido y citas del modelo siguen sin demostrar exactitud.

Si el apoyo OCR/conversión falla pero el lector principal obtuvo datos, se conservan esos datos y se produce
revisión, con el fallo en procedencia y sin autoautorizar. El usuario puede confirmar los datos o pedir una nueva
lectura; no necesita volver a subir el mismo archivo. No se guarda un artefacto secundario fallido como exitoso.
La interfaz explica la duda de negocio sin hablar de lectores; arquitectura, errores originales y evidencia van a Logs.

Los apartados fechados 2026-10-17 siguientes documentan la implementación anterior. Para el comportamiento
actual de revisión humana, protocolo de imágenes y manejo de fallos secundarios, prevalece esta actualización.

## Estado de la implementación (2026-10-17)

El Worker usa Mistral OCR vía OpenRouter para el candidato PDF y conversión de texto independiente
vía Workers AI para corroborarlo. Ambas lecturas arrancan en paralelo; el parser conservador de
etiquetas compara los ocho campos y obtiene la referencia de acuerdo exclusivamente del texto
independiente. El contrato `checkExtraction()` mantiene sus cuatro campos críticos; las diferencias
adicionales se convierten en advertencias bloqueantes antes de invocarlo. No se infiere una moneda
por defecto ni se reparan respuestas JSON truncadas.

El parser `labelled-v5` reconoce etiquetas explícitas en español/inglés, filas Markdown de
clave/valor y textos que la conversión pegó a encabezados o pies conocidos. Una moneda ISO
explícita en el total puede corroborar la moneda cuando no existe una etiqueta separada; `$`
solo no basta. Encabezados o descripciones idénticos repetidos entre páginas pueden coincidir;
duplicados en la misma página y totales repetidos siguen siendo inciertos. Subtotales no se
convierten en totales finales. Se conservan los totales de tablas no interpretadas como posibles
contradicciones. La nueva versión invalida artefactos de lectores anteriores; no modifica
decisiones históricas. La [comparación controlada](evaluations/pdf-parser-v5-paired.json) separa
la cobertura del parser de las llamadas reales al modelo y del procesamiento financiero.

Los importes se convierten con `BigInt`, exponentes de moneda y formatos explícitos de separadores.
`1,234.56` y `1.234,56` son formatos reconocibles; `1,234`/`1.234` ambiguos requieren revisión.
Las observaciones informativas del modelo son tres etiquetas acotadas separadas de las advertencias;
ninguna advertencia recibida se elimina. El modelo tiene un presupuesto de salida de 4096 tokens
con el control de razonamiento compatible con cada proveedor.

El límite de bytes no acredita un límite de páginas PDF: falta validar un máximo de páginas antes del OCR. Para imágenes se incorpora el canal Qwen descrito abajo; su modo de despliegue determina si solo se mide o permite evaluar reglas. Tampoco se promete cubrir diseños
arbitrarios ni verificar aritmética de líneas que no se hayan extraído. Las mediciones del corpus
están en [INVOICE_CORPUS_EVALUATION.md](INVOICE_CORPUS_EVALUATION.md); los tests unitarios no las sustituyen.

Las facturas tienen un trabajo durable creado por trigger D1 al recibirlas. Cola, leases y recuperación
periódica toleran duplicados y caídas; se conservan decisiones, reservas e intentos. Se cachean lecturas
inmutables por empresa/hash/versión/canal, nunca decisiones: la política y el presupuesto se vuelven
a consultar en el commit financiero. El primer presupuesto debe haberse inicializado; solo se permite
renovación automática de una moneda que ya tenga un periodo anterior.

La clasificación del tipo de documento también es explícita y separada de los campos extraídos.
Comprobantes de pago, notas de entrega/crédito, cotizaciones y otros documentos identificados
como ajenos a una factura producen `BLOCK / NOT_AN_INVOICE`. Un tipo incierto produce revisión;
no se deduce «no factura» solo porque falten datos. Que el modelo diga `INVOICE` no acredita
exactitud y nunca sustituye la corroboración y los controles del motor. Las respuestas del lector
requieren el tipo en un enum cerrado; el nuevo prompt/schema invalida la caché anterior.

## 1. Decisión de arquitectura

### Segunda lectura de imágenes elegida por Oscar

PNG/JPEG usan el lector primario DeepSeek (con los respaldos existentes) y una llamada separada
a `qwen/qwen3.8-flash`, ambos vía OpenRouter y con `OPENROUTER_API_KEY`. Qwen recibe únicamente
la imagen original y una instrucción de transcripción literal: no recibe el candidato, acuerdos,
políticas ni referencias esperadas del corpus. No se añade ninguna cuenta de Google ni un VPS.

Qwen transcribe texto; el parser del servidor interpreta etiquetas, importes y fechas y compara
los ocho campos con el candidato primario. Los marcadores de ilegibilidad, recorte o ambigüedad
se convierten en advertencias bloqueantes. El servidor genera hash, identidad y versión de lectura.
La transcripción, proveedor, modelo y uso reportado quedan en la procedencia para auditoría.
Las citas o ausencia de marcadores del modelo no acreditan exactitud. Los lectores pueden coincidir
en un error y ambos dependen de la disponibilidad de OpenRouter.

`IMAGE_OCR_MODE` es configuración del servidor: `OFF` no hace la segunda llamada; `SHADOW`
la registra y conserva una advertencia que impide autoevaluar; `ENABLED` permite evaluar únicamente
cuando coinciden los campos y no existen advertencias. El motor, la revisión humana y las reservas
atómicas de D1 siguen siendo obligatorios. Los PDF mantienen el canal independiente de texto
Workers AI; no se reemplaza por una segunda lectura del mismo OCR de PDF.

Cada intento de procesamiento hace como máximo una llamada a Qwen, con 12 s y 4096 tokens de
salida como límites. Una respuesta truncada, otro modelo o un fallo no se reparan ni se reemplazan
por un modelo más favorable. Los reintentos durables reutilizan la lectura que ya tuvo éxito;
las versiones nuevas invalidan los artefactos anteriores. No se cachea una decisión financiera.

El protocolo inicial con envoltura JSON tuvo fallos de tipo y se conserva su evaluación fallida.
El protocolo actual pide texto literal acotado, sin reparar aquellas respuestas. El parser
`labelled-v6` tolera espacio vacío entre una etiqueta explícita y su valor; no ignora contradicciones.
Las mediciones de lectores, comparación y decisiones se documentan separadamente.

Usar extracción híbrida y verificaciones deterministas. No considerar una respuesta JSON,
una cita ni un porcentaje de confianza generado por el modelo como prueba de exactitud.

```text
Archivo ficticio original → validación y SHA-256 en servidor
  ├─ Lectura visual del documento con IA → candidato estructurado
  └─ Canal separado → texto del PDF o un extractor OCR
                         ↓
                Comparación de campos críticos
                         ↓
      Coinciden sin advertencias → evaluar todas las reglas
      Faltan/contradicen datos   → revisión/corrección, sin autoaprobar
                         ↓
       Policy Engine → commit atómico de decisión/reserva/auditoría
```

El canal separado se ejecuta sobre el mismo archivo original y produce datos con evidencia
localizable. Para PDF con texto, la IA visual y el parser de texto son canales distintos.
Para imágenes/PDF escaneado, se necesita el resultado de un OCR separado antes de considerar
la autoevaluación. Ese OCR puede usar aprendizaje automático: no se promete que su lectura sea determinista.

Un segundo mensaje al mismo modelo no demuestra independencia. Dos canales también pueden
coincidir en un error: la comparación reduce riesgos detectables, no garantiza verdad absoluta.
La implementación final de adapters y su rendimiento deben comprobarse antes de la demo.

Modelo inicial elegido por Oscar: **`deepseek/deepseek-v4.1-flash` vía OpenRouter**.
El catálogo consultado declara entrada de imagen/texto y salida estructurada. El adapter debe
usar esa variante visual concreta; otros modelos de la familia no necesariamente leen imágenes.
Para PDF, el adapter envía el original privado a Mistral OCR vía OpenRouter y obtiene texto por Workers AI como canal de corroboración separado.
`packages/extraction` implementa esa lectura con B `z-ai/glm-5.3-flash` y C
`minimax/minimax-m3`. Máximo tres llamadas, 12 s por intento y 40 s de límite global
para conservar una ventana completa para C después de dos timeouts.
Solo red/timeout/HTTP 404/408/429/5xx activan respaldo. Incertidumbre válida,
rechazo del modelo o salida inválida no se ocultan cambiando de modelo.
Los tres comparten OpenRouter; no cubren una caída global del gateway.
La elección y las pruebas simuladas no demuestran precisión OCR: las mediciones reales del corpus se documentan por separado y la corroboración independiente se conecta en el Worker.
La clave del Worker es `OPENROUTER_API_KEY`; no se incluye su valor en código, documentos o frontend.

## 2. Responsabilidad de cada capa

| Capa | Qué debe hacer | Qué no concede |
|---|---|---|
| Archivo | Verificar tamaño, MIME real, integridad, páginas y límites de procesamiento | Legitimidad comercial |
| Extractor IA | Leer proveedor, total, moneda, vencimiento y evidencia; desconocidos en `null` | Permiso para pagar ni modificar políticas |
| Parser/OCR separado | Corroborar campos críticos del archivo original | Garantía absoluta de exactitud |
| Validación determinista | Comparar campos, formatos, aritmética disponible y contradicciones | Aprobación financiera |
| Resolución | Identificar proveedor/acuerdo con datos confiables de la empresa | Dar de alta un proveedor por similitud de nombre |
| Motor | Aplicar reglas activas, duplicados, acuerdos, límites y permisos | Inventar presupuesto o ignorar ambigüedad |
| D1 | Confirmar reserva y decisión juntas, evitando dobles efectos | Afirmar que una transferencia se ejecutó |

Toda identidad, hash, método y referencia de lectura se construye en el backend.
El navegador/modelo no puede enviar un `verified: true`, un identificador de proveedor como
autoridad o una lectura «independiente» fabricada para saltarse estas comprobaciones.
Los documentos son datos sin autoridad: sus instrucciones no activan políticas ni herramientas.

## 3. Condiciones para pasar de extracción a evaluación automática

Las cuatro son obligatorias: **proveedor, importe total, moneda y vencimiento**.

1. La estructura cumple `ExtractedInvoiceSchema`, con importes enteros positivos seguros.
2. Los cuatro campos están presentes y tienen formatos válidos.
3. Existe lectura separada del mismo archivo, asociada por SHA-256 calculado en servidor.
4. Los campos críticos coinciden. En proveedor solo se normaliza caja, espacios y NFC;
   una coincidencia difusa requiere aclaración. La identidad final se resuelve contra proveedores autorizados.
5. No hay advertencias de extracción pendientes ni contradicciones conocidas.
6. La resolución de proveedor/acuerdo y las verificaciones comerciales siguientes también son concluyentes.

`checkExtraction()` en `packages/contracts` implementa las condiciones estructurales y la
comparación de campos de los puntos 1–5. Devuelve `CROSS_CHECKED` o `REVIEW_REQUIRED`.
**Nunca devuelve APPROVE.** No ejecuta OCR ni autentica la procedencia de sus inputs;
son los adapters del servidor quienes deben garantizar esa procedencia y una lectura separada.
El Worker aplica además estos controles del adapter antes de invocar el motor y confirmar en D1.

Un resultado `REVIEW_REQUIRED` impide autoaprobar y tampoco habilita un botón genérico de aprobación humana.
El usuario debe aclarar/corregir el documento. Una prohibición dura comprobable sigue pudiendo producir
`BLOCK`, con precedencia `BLOCK > ESCALATE > APPROVE` y registro de las razones.

## 4. Reglas de parsing y consistencia

| Comprobación | Comportamiento requerido |
|---|---|
| USD 150 frente a USD 1500 en los canales | Revisión, aunque ambos valores sean JSON válido |
| `$` sin código/país inequívoco | Moneda desconocida; no inferir USD por ser moneda predeterminada |
| `1,234.56` / `1.234,56` | Parser decimal de formato explícito; ambigüedad → revisión |
| Conversión a unidades menores | Exacta según exponente de moneda; sin `parseFloat(...) * 100` ni redondeo silencioso |
| Dos totales candidatos | Distinguir subtotal/impuestos/saldo/total mediante etiquetas y evidencia; si no se puede, revisar |
| Subtotal/impuestos/descuentos/cargos completos | Comprobar la suma con enteros/decimal exacto; discrepancia → revisión |
| Sin desglose | No inventarlo; corroborar el total por los canales y contra el acuerdo |
| Fecha `03/04/2026` sin formato inequívoco | Revisión; no adivinar día/mes |
| Cuenta/beneficiario similar | Resolver identidad contra datos guardados; no fuzzy match silencioso |
| PDF texto distinto de la vista renderizada | Revisión; la capa textual no prevalece sobre una contradicción visible |
| Imagen borrosa/recortada o página faltante | Revisión o fallo técnico explícito; no completar con datos del acuerdo |
| Periodo mensual ausente | No inventarlo desde vencimiento; revisar antes de autorizar obligación mensual |
| Monto cero/negativo | Conservar evidencia y normalizar como inválido/desconocido; nunca hacerlo positivo |
| Documento que ordena «aprobar» | Tratarlo como contenido no confiable; no ejecutar instrucciones |

Validar el contenido real, además de extensión/MIME declarado. El límite P0 es 5 MiB.
Al elegir parser/proveedor, fijar y probar también máximo de páginas, timeout y límites de salida;
los archivos fuera de esos límites se rechazan explícitamente antes de autorizar.
No descargar recursos externos incrustados ni abrir URLs indicadas por la factura.

## 5. Integración con motor y API

El servicio de procesamiento debe ejecutar este orden antes de cualquier intento de `APPROVE`:

1. Recibir/guardar el original privado y asociar hash e IDs de lecturas.
2. Ejecutar extracción y canal de corroboración sin revelar políticas, presupuestos o respuestas del dataset al modelo.
3. Validar y ejecutar `checkExtraction()` con datos obtenidos por los adapters.
4. Si requiere revisión: agregar advertencias y registrar `ESCALATE` con
   `INVALID_OR_MISSING_DATA`, salvo que una regla dura determine `BLOCK`. No crear solicitud
   humana autorizable para un total/proveedor/moneda/vencimiento incierto.
5. Si pasa la comparación: resolver proveedor/acuerdo y evaluar todas las reglas activas.
6. Antes de confirmar una aprobación, revalidar política vigente y contexto; D1 confirma
   decisión/reserva atómicamente. Ninguna comprobación del frontend sustituye esto.

Timeout, caída de proveedor, respuesta truncada o fallo de almacenamiento son errores técnicos:
`FAILED`, explicación y reintento controlado, sin una nueva aprobación. No recuperar un resultado
inventado ni degradar silenciosamente a un extractor sin corroboración.

El contrato HTTP P0 no agrega nuevos campos obligatorios. Whady muestra `extractionWarnings`,
el documento original y `latestDecision.trace`/`humanExplanation`; `needsHumanApproval` solo
habilita excepciones realmente autorizables. No mostrar «verificado» a partir de un porcentaje del modelo.
Conservar el último estado confirmado mientras procesa o falla una petición.

## 6. Evidencia para reproducir errores

Registrar en servidor (sin claves ni PDFs completos en logs):

- Hash del original, tipo, páginas y referencias al archivo privado.
- Modelo/proveedor, versión de prompt/parser y IDs de ambas lecturas.
- Valores normalizados y evidencia por campo, página y fragmento/ubicación cuando exista.
- Diferencias encontradas y motivos estructurados de revisión.
- Versión de política, actor, timestamps y decisión final.

Una caché de extracción debe vincular hash + modelo + prompt + parser y reglas de verificación.
No reutilizar una decisión financiera cacheada cuando cambien reglas, proveedor, acuerdo o presupuesto.
Cachear ayuda con repetición/latencia; no demuestra exactitud.

## 7. Pruebas que bloquean declarar listo el flujo

La evaluación del extractor se hace sobre los PDF/PNG **sin enviar** `expectedExtraction`,
`expected`, proveedores/acuerdos de referencia ni etiquetas al modelo.
El runner compara después con las respuestas etiquetadas y registra todas las ejecuciones.

| Nivel | Pruebas | Estado |
|---|---|---|
| Contratos | Formatos, campos extra, dinero seguro, fechas/monedas | Implementado |
| Corroboración | Campos críticos discrepantes, fuente distinta, lectura repetida, warnings y datos incompletos | Implementado con datos simulados de adapters |
| D1 | Presupuesto concurrente, doble reserva, rollback e integridad del historial | Implementado en D1 local |
| Parsing | Formatos monetarios/fechas, totales múltiples, aritmética y PDF texto/vista | Pendiente |
| Extractor real | PDF y PNG contra dataset etiquetado, fallos y prompt injection | Diez PNG evaluados; discrepancia de importe y un timeout detectados. PDF y perturbaciones pendientes. Ver `EXTRACTION_EVALUATION.md` |
| Motor | Cada caso normal/trampa y contexto independiente | Pendiente |
| End-to-end | Archivo → corroboración → decisión → D1 → frontend | Pendiente |

Agregar perturbaciones que no estén todas presentes en el generador de fixtures: imágenes
borrosas/rotadas, recortes, layouts nuevos, páginas múltiples, separadores decimales y dos totales.
Conservar un conjunto reservado que no se use para ajustar prompts. Probar repetidas ejecuciones,
sin seleccionar solo la mejor. El dataset sintético sirve para la demo, no certifica precisión general.

Medir por separado:

- Exactitud por campo crítico y por formato, comparada con el valor etiquetado.
- Errores críticos que la corroboración dejó pasar y cuántos fueron enviados a revisión.
- Aprobaciones indebidas end-to-end: **cero en el conjunto evaluado**.
- Autonomía correcta, falsos bloqueos/escalaciones y cobertura de explicaciones.
- Latencia, timeouts y fallos por proveedor/formato.

Un error crítico que pueda llegar a aprobación detiene la entrega de ese flujo hasta corregirlo
o hacerlo escalar explícitamente. Los resultados sobre un corpus finito no son garantía universal.
Las pruebas de contrato/persistencia no pueden presentarse como precisión OCR ni como desempeño del agente.

## 8. Secuencia de implementación y demo en vivo

1. **Implementado:** regla de corroboración, adapter visual A/B/C y prueba privada PNG/JPEG del Worker; sin cambiar el contrato público P0.
2. **Siguiente:** motor determinista y pruebas del reto, incluyendo el bloqueo por extracción no corroborada.
3. Completar renderizado PDF y canal independiente de texto/OCR; evaluar el corpus ficticio con el modelo elegido.
4. Construir parsing seguro y evidencia por campo; conectar ambos canales al guard y al motor.
5. Integrar API/D1/frontend y correr evaluación end-to-end antes de publicar métricas.
6. Ensayar la demo completa y comprobar en el entorno desplegado las mismas reglas y fallos.

En vivo, empezar con un PDF/PNG ficticio legible y luego mostrar un caso trampa. Permitir carga
de documentos nuevos, manteniendo el mismo estándar de revisión ante incertidumbre. Si el modelo
falla o no puede corroborarse un campo, mostrar el motivo y conservar la factura sin autoaprobar.
No falsificar una respuesta de respaldo ni sustituir el archivo enviado por una etiqueta del dataset.

La promesa de demo es: **las dudas se hacen visibles y no conceden autoridad automática**.
La demostración debe incluir aprobaciones seguras y revisión útil; escalar todo tampoco cumple
el objetivo de autonomía del reto. La configuración final del proveedor/ruta se verificará con
resultados medidos, no por un porcentaje supuesto.

## Referencias técnicas

- [AWS Textract: calidad de entrada y revisión de resultados inciertos](https://docs.aws.amazon.com/textract/latest/dg/textract-best-practices.html)
- [Google Document AI: evaluar contra documentos etiquetados](https://docs.cloud.google.com/document-ai/docs/evaluate)
- [OWASP: prompt injection en contenido no confiable](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)
