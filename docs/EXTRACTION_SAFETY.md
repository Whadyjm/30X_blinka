# Extracción robusta y demostración en vivo

Fuente superior: [RETO_BLINKA.md](../master_files/RETO_BLINKA.md).
El objetivo es resolver correctamente facturas y **no aprobar fuera de las reglas**.
La extracción de documentos puede equivocarse; la arquitectura debe detectar incertidumbre
y permitir revisión/corrección antes de que se autorice algo con datos no corroborados.

## Estado de la implementación (2026-10-17)

El Worker usa Mistral OCR vía OpenRouter para el candidato PDF y conversión de texto independiente
vía Workers AI para corroborarlo. Ambas lecturas arrancan en paralelo; el parser conservador de
etiquetas compara los ocho campos y obtiene la referencia de acuerdo exclusivamente del texto
independiente. El contrato `checkExtraction()` mantiene sus cuatro campos críticos; las diferencias
adicionales se convierten en advertencias bloqueantes antes de invocarlo. No se infiere una moneda
por defecto ni se reparan respuestas JSON truncadas.

Los importes se convierten con `BigInt`, exponentes de moneda y formatos explícitos de separadores.
`1,234.56` y `1.234,56` son formatos reconocibles; `1,234`/`1.234` ambiguos requieren revisión.
Las observaciones informativas del modelo son tres etiquetas acotadas separadas de las advertencias;
ninguna advertencia recibida se elimina. El modelo tiene un presupuesto de salida de 4096 tokens
con el control de razonamiento compatible con cada proveedor.

El límite de bytes no acredita un límite de páginas PDF: falta validar un máximo de páginas antes del OCR. Las imágenes siguen sin OCR independiente: no se autoaprueban. Tampoco se promete cubrir diseños
arbitrarios ni verificar aritmética de líneas que no se hayan extraído. Las mediciones del corpus
están en [INVOICE_CORPUS_EVALUATION.md](INVOICE_CORPUS_EVALUATION.md); los tests unitarios no las sustituyen.

Las facturas tienen un trabajo durable creado por trigger D1 al recibirlas. Cola, leases y recuperación
periódica toleran duplicados y caídas; se conservan decisiones, reservas e intentos. Se cachean lecturas
inmutables por empresa/hash/versión/canal, nunca decisiones: la política y el presupuesto se vuelven
a consultar en el commit financiero. El primer presupuesto debe haberse inicializado; solo se permite
renovación automática de una moneda que ya tenga un periodo anterior.

## 1. Decisión de arquitectura

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
