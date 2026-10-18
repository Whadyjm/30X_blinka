# Robustez de la infraestructura de OLI

**Fecha de corte: 17 de octubre de 2026, Caracas.** Alcance: demo del hackatón y preparación para una función de uso masivo. Complementa el [informe de costos](COSTOS_OLI_20261017.md).

## Conclusión para producto

**OLI tiene mecanismos concretos para recuperarse de fallas parciales y evitar que un error técnico se convierta en una autorización.** Guarda el trabajo pendiente, limita los intentos, conserva lecturas exitosas y comprueba política y reserva en la base de datos. Si un LLM no atiende, no se asume que la factura está aprobada.

**La disponibilidad completa depende de Cloudflare y OpenRouter.** Hay modelos alternativos para la lectura primaria, pero no una segunda plataforma de inferencia ni un despliegue independiente de Cloudflare. El chat y el OCR secundario de imágenes tampoco tienen otro modelo configurado en la aplicación. Una caída prolongada puede dejar trabajos fallidos que requieren intervención.

La demo está respaldada por la [evaluación final de veinte documentos](evaluations/FINAL_CANDIDATE_20261017.md). La preparación para público masivo exige completar la operación ante incidentes, probar recuperación de datos y medir capacidad y tiempos de recuperación. Las pruebas locales de fallas controladas se conservan en [la evidencia de esta revisión](robustness/review-20261017.json); no son una simulación de caída real en producción ni una medición de disponibilidad mensual.

## Qué significa una falla para el usuario

Conviene separar tres resultados:

- **Espera o reintento:** OLI conserva una tarea y puede continuar cuando vuelve la dependencia, mientras queden intentos.
- **Fallo técnico:** no pudo completar una lectura o su procesamiento. Una factura nueva puede quedar `FAILED` sin una nueva decisión de autorización. No equivale a rechazar comercialmente la factura.
- **Escalamiento:** hubo una lectura utilizable pero existe incertidumbre o una condición que requiere intervención. No todo `ESCALATE` habilita un botón de aprobación; una lectura incierta no obtiene una excepción humana genérica.

El objetivo es conservar la corrección cuando se pierde disponibilidad. Esto no demuestra ausencia universal de errores de lectura: dos modelos pueden equivocarse y una respuesta JSON válida puede contener datos incorrectos. [Garantías de extracción](EXTRACTION_SAFETY.md).

## Dependencias y fallas compartidas

El Worker sirve la API y coordina consumidores de colas, cron y canales. D1 conserva las reglas, trabajos, lecturas, decisiones e historial; R2 conserva documentos. OpenRouter conecta todos los LLM. La segunda lectura PDF depende de `AI.toMarkdown` de Cloudflare. [Configuración vigente](../apps/api/wrangler.jsonc), [entrada del Worker](../apps/api/worker/index.js).

La diversidad de modelos reduce ciertos fallos individuales, pero conserva dependencias comunes: una clave sin saldo o una caída general de OpenRouter afectan a todos los modelos; una falla amplia de Cloudflare puede afectar API, datos, documentos, colas y conversión. La redundancia interna del proveedor no equivale a una contingencia independiente implementada por OLI.

## Matriz de incidentes

| Qué falla | Efecto visible | Respuesta actual de OLI | Recuperación y límite |
| --- | --- | --- | --- |
| Un lector primario no responde, devuelve 429 o error operativo | Una factura tarda más | Prueba el siguiente modelo de su lista, dentro de límites de tiempo | Automática si otro responde; conserva el intento fallido |
| Todos los lectores primarios fallan | Factura pendiente durante reintentos y finalmente fallida | El trabajo puede reintentarse hasta agotar su presupuesto; no inventa extracción | Al llegar a `DEAD`, requiere intervención; no revive solo |
| OpenRouter completo no responde | Fallan nuevas lecturas y conversación | Se agotan rutas acotadas; historial y reglas pueden seguir accesibles si Cloudflare funciona | No hay conexión directa alternativa a otro proveedor |
| Clave LLM inválida o saldo agotado | Lectura o chat falla | Extracción trata credenciales/saldo como error permanente y evita recorrer todos los modelos inútilmente | Corregir clave o saldo; eso no reactiva por sí solo trabajos terminales |
| LLM devuelve JSON inválido o rechaza responder | Fallo técnico de lectura | No oculta esa salida buscando otro modelo que dé una respuesta más favorable | Generalmente permanente; truncamiento de salida tiene una excepción de reintento acotado |
| LLM responde con incertidumbre o lectores discrepan | Factura requiere aclaración o se bloquea por otras reglas | Conserva las advertencias y aplica el motor; no autoaprueba con lectura incierta | Se resuelve la causa; no se consulta hasta obtener un “sí” |
| Qwen, segundo lector de PNG/JPEG, no responde | Imagen sin procesamiento completo | Conserva la lectura primaria si pudo guardarla y reintenta la secundaria | No hay un segundo modelo OCR configurado; puede terminar fallida |
| Conversión PDF de Cloudflare falla o tarda demasiado | PDF sin corroboración completa | Si el servicio falla, registra error técnico y conserva la lectura primaria exitosa | Reintento acotado; no sustituye la lectura separada por otra conversación con Gemini |
| LLM del chat no responde | Mensaje de error en conversación | No publica las propuestas preparadas por un turno que no terminó; no ejecuta cambios de configuración por ese fallo | Reintento del usuario acotado; no hay cambio automático de modelo |
| R2 no permite escribir o leer | Fallan subidas nuevas, previews o lecturas del original | No crea una autorización a partir de un documento que no pudo leer y verificar | Reintentos del procesamiento pueden recuperar una caída corta; original perdido requiere recuperación de datos |
| D1 no responde o se satura | Fallan sesiones, consultas y cambios | No puede validar política ni registrar autorización; los consumidores intentan no confirmar trabajo sin finalizar | Depende de recuperación de D1; una respuesta perdida exige consultar el resultado antes de repetir |
| No se puede publicar en la cola de facturas | Documento recibido, procesamiento detenido | La intención de trabajo ya está en D1; el cron intenta publicarla después | Recuperable si D1, cron y cola vuelven; no sirve si la caída precedió al registro durable |
| Un consumidor se interrumpe o recibe el mismo mensaje dos veces | Retraso o reentrega | Usa identificadores de trabajo y permisos temporales de ejecución; recupera trabajo abandonado | No debe duplicar decisión/reserva ya confirmada; llamadas externas pueden haberse cobrado antes de guardar su resultado |
| Cron deja de ejecutarse | Algunos pendientes o recuperaciones tardan más | Mensajes ya entregados pueden seguir ejecutándose; las recuperaciones que dependen del cron quedan detenidas | Restaurar cron y revisar atraso; no hay otro scheduler independiente |
| Telegram no entrega mensajes | Falta el aviso o la respuesta del bot | La decisión ya guardada no se revierte; guarda progreso de entrega e intenta continuar | Reintentos limitados para eventos del bot; no hay recuperación cron de esos eventos |
| Canal de correo no recibe | Nuevas facturas por correo no aparecen | La web puede seguir recibiendo documentos; OLI no puede recuperar un correo que nunca ingresó | Verificar entrega con el remitente; un correo ya registrado sí tiene recuperación por cron |
| Navegador pierde conexión o vence la espera HTTP | El usuario desconoce si se guardó | Los trabajos de facturas ya registrados continúan; las operaciones usan idempotencia | Consultar/repetir la misma operación con la misma clave; una falta de respuesta no prueba que no ocurrió |
| Despliegue defectuoso, dominio o caída amplia de Cloudflare | Servicio parcial o totalmente inaccesible | No hay una segunda plataforma preparada para asumir el servicio | Revertir código compatible o esperar recuperación; no existe conmutación independiente automática |

Fuentes del comportamiento implementado: [extractor](../packages/extraction/src/openrouter.ts), [lectores independientes](../apps/api/worker/document.js), [procesamiento](../apps/api/worker/processing.js), [trabajos](../apps/api/worker/jobs.js), [chat](../apps/api/worker/chat.js), [subida](../apps/api/worker/invoices.js), [correo](../apps/api/worker/email.js), [Telegram](../apps/api/worker/telegram.js).

## Si un LLM no atiende

### Respaldo de la lectura primaria

Para imágenes: **DeepSeek V4.1 Flash → GLM 5.3 Flash → MiniMax M3**. Para PDF: **Gemini 3.8 Flash → Gemini 3.7 Flash → Gemini 3.1 Flash Lite**. El PDF original se envía al modelo con procesamiento nativo; Cloudflare produce la lectura de texto separada.

La aplicación cambia de modelo ante fallas operativas como red, timeout, 404, 408, 429 y errores de servidor. Algunos HTTP 400 tipados o con indicios acotados de saturación también permiten respaldo. Una clave inválida, falta de saldo, rechazo del modelo o contenido inválido no se tratan como permiso para buscar una salida más favorable. OpenRouter también puede cambiar de proveedor para un mismo modelo, pero permanece dentro de la misma plataforma. [Código de clasificación](../packages/extraction/src/openrouter.ts), [ruteo de proveedores](https://openrouter.ai/docs/guides/routing/provider-selection).

### Tiempos y presupuestos configurados

| Capa | Límite configurado | Interpretación |
| --- | --- | --- |
| Lector primario | Hasta 12 segundos por modelo, tres modelos y presupuesto global de 40 segundos | Ventanas del adaptador; no representan una garantía de respuesta de toda la factura |
| OCR Qwen | Un modelo, ventana de 12 segundos por ejecución | Sin alternativa de modelo en la aplicación |
| Texto PDF separado | Espera máxima de 15 segundos | El timeout deja la lectura fallida sin cachear; la operación externa puede haber comenzado |
| Trabajo de factura | Hasta tres intentos de procesamiento | Diferente de los reintentos de entrega de la cola |
| Espera entre intentos de factura | 30 segundos tras el primero y 120 tras el segundo | El despacho depende además del cron, la cola y el atraso |
| Permiso del procesador | 120 segundos | Permite reclamar una ejecución abandonada cuando corresponde |
| Permiso del trabajo de cola | 180 segundos | Otro ejecutor no debe finalizar con el identificador vencido de una ejecución anterior |
| Chat | Hasta tres rondas, cuatro herramientas, ventana de hasta 20 segundos por llamada y presupuesto de rondas de 35 segundos | Ese presupuesto no cubre una garantía global de latencia incluyendo toda consulta y persistencia |
| Turno de chat web | Hasta tres intentos; ejecución en curso se considera reciente durante 90 segundos | No tiene un recuperador cron propio; se retoma al volver a solicitarlo |

Los dos lectores de una factura arrancan por separado y en paralelo. Si uno termina, su resultado se guarda por empresa, hash, versión y tipo de lectura. Un reintento puede reutilizar ese resultado y repetir solamente la parte que falta. **Se cachean lecturas, nunca una autorización para reutilizarla sin comprobar las reglas vigentes.**

Hay una diferencia de configuración relevante: un servicio PDF presente que falla produce `INDEPENDENT_READ_UNAVAILABLE`; si falta el binding de conversión, la lectura queda sin corroboración y requiere revisión. Ninguna de las dos situaciones habilita autoaprobar. [Implementación y pruebas de lectores](../apps/api/tests/document-reliability.test.mjs).

## Si se interrumpe el procesamiento

La inserción de una factura crea su trabajo pendiente en la misma transacción D1 mediante un trigger. Publicar el mensaje en la cola sucede después. Por eso puede recuperarse una factura confirmada en D1 aunque el envío a la cola falle o el Worker se interrumpa entre ambos pasos. [Migración de trabajos durables](../packages/database/migrations/0005_invoice_jobs.sql).

Cada mensaje transporta la identidad del trabajo. Al ejecutar se registra un permiso temporal con token; los duplicados concurrentes esperan y los tokens antiguos no deben sobrescribir al ejecutor nuevo. Si la decisión y reserva ya se confirmaron, una reentrega reconoce el estado y no vuelve a crearlas. Si el proceso se corta antes de guardar una lectura externa exitosa, puede necesitar llamarla otra vez: la protección contra doble reserva no garantiza una única factura del proveedor de IA.

Cloudflare Queues ofrece entrega **al menos una vez**, por lo que OLI debe tolerar duplicados. La cola de facturas tiene tres reintentos de transporte y una DLQ, una cola que recibe entregas agotadas. Estos contadores no amplían los tres intentos de procesamiento persistidos en D1. Un trabajo agotado que la aplicación marca `DEAD` puede confirmar su mensaje normalmente y **no aparecer en la DLQ**. La fuente para investigar es D1 junto con los logs, no solamente la DLQ. [Entrega de Queues](https://developers.cloudflare.com/queues/reference/delivery-guarantees/), [reintentos](https://developers.cloudflare.com/queues/configuration/batching-retries/), [DLQ](https://developers.cloudflare.com/queues/configuration/dead-letter-queues/).

El cron corre cada minuto. Cada barrido busca hasta cien trabajos abandonados y hasta cien listos para despacho; correo tiene un barrido separado de hasta veinticinco recibos. Los consumidores están limitados a dos por cola. Estos límites contienen el trabajo y también pueden alargar la recuperación tras un pico. Un error que interrumpe `recoverInvoiceJobs()` antes de terminar también impide que esa ejecución del cron llegue a `recoverEmails()`.

**Una caída larga no se resuelve con reintentos eternos:** al alcanzar `DEAD`, el cron y el endpoint de procesamiento no lo reabren. La función de volver a leer un documento tiene condiciones distintas y no es un botón general de recuperación de trabajos terminales. [Trabajos](../apps/api/worker/jobs.js), [volver a leer](../apps/api/worker/reread.js).

## Si fallan los datos o el almacenamiento

### Autorización y resultado incierto de una petición

La decisión, auditoría y reserva correspondiente se confirman en un batch D1; los triggers validan las condiciones y crean la reserva atómica. Si una sentencia del batch falla, D1 revierte su transacción. Si cambia la revisión de la empresa o el presupuesto durante el procesamiento, OLI vuelve a evaluar contra un snapshot nuevo, con intentos acotados. [Procesamiento](../apps/api/worker/processing.js), [triggers](../packages/database/migrations/0001_initial.sql), [transacciones batch de D1](https://developers.cloudflare.com/d1/worker-api/d1-database/).

**Una respuesta HTTP perdida no demuestra que hubo rollback.** La operación puede haberse confirmado antes del corte. Antes de repetir una aprobación, se consulta el estado y se conserva la clave de idempotencia de la misma operación. La revisión humana vuelve a comprobar la política y el presupuesto; no elimina estos controles por estar en contingencia.

### Ventana entre R2 y D1

R2 y D1 no comparten una transacción. En una subida se escribe primero el original y después su registro D1; si el batch lanza un error, se intenta borrar el objeto como compensación. Esto cubre fallos ordinarios, pero **un commit D1 ambiguo requiere reconciliación**: un error observado después de confirmar D1 puede activar el borrado del objeto que ahora referencia una factura existente. También puede quedar un objeto huérfano si una ejecución se corta antes de confirmar D1 o si falla su limpieza.

Ese riesgo se identifica por inspección del flujo; no se presenta como un incidente observado. Antes de una apertura masiva conviene implementar un estado durable de ingreso y una reconciliación de registros/objetos que resuelva primero la ambigüedad. Mientras tanto, una factura sin original íntegro no se debe recuperar borrando historial ni inventando un documento. [Subida](../apps/api/worker/invoices.js), [ingreso por correo](../apps/api/worker/email.js).

Una caída de R2 no elimina automáticamente las lecturas y decisiones ya almacenadas en D1. Algunas consultas, reevaluaciones de hechos guardados y revisiones pueden seguir disponibles si sus precondiciones se cumplen; los originales y las nuevas lecturas no. La integridad de los bytes se comprueba contra tamaño y SHA antes de una nueva lectura.

### Restauración de datos

D1 dispone de Time Travel en su almacenamiento de producción, con ventanas de hasta treinta días en Paid y siete en Free. Es una capacidad del proveedor; no equivale a un ensayo de restauración de OLI. La restauración de D1 tampoco restaura coordinadamente R2 ni deshace mensajes que Telegram ya entregó. Hay que reconciliar originales, recibos, trabajos y decisiones antes de reanudar. [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).

No hay un tiempo de recuperación de desastre ni una pérdida máxima de datos medidos para el conjunto OLI. La existencia de triggers append-only protege frente a cambios ordinarios de la aplicación; no sustituye una estrategia de respaldo y restauración frente a pérdidas o intervenciones administrativas.

## Si falla un canal

**Telegram:** si falla la publicación del webhook en su cola, la API responde 503 para permitir reentrega del canal. Si la decisión ya existe y falla el envío de su aviso, intenta entregar la respuesta guardada sin volver a procesar la factura. La aplicación marca el evento como fallido a partir de su quinto intento; esa cola no tiene DLQ configurada y el cron no rescata sus eventos. También puede quedar un evento sin entregar si se agota el transporte antes de que la aplicación registre su fallo. La entrega posterior requiere inspección del evento y recuperación controlada.

**Correo:** una vez guardados el recibo y los adjuntos, puede continuar mediante cron aunque falle la publicación inicial. La espera por una factura no consume otra lectura. Si falla una notificación a Telegram, conserva el recibo para reintentarlo. A diferencia de los trabajos de factura, este ciclo de notificación no tiene un tope global de intentos en la aplicación: una caída prolongada puede producir reintentos indefinidos y retener adjuntos temporales.

**Avisos duplicados:** guardar progreso reduce reenvíos, pero persiste una ventana entre que Telegram acepta `sendMessage` y que D1 registra el avance. Un corte en ese punto puede repetir el aviso. No se afirma entrega exactamente una vez; eso es distinto de la idempotencia de decisiones y reservas.

**Web y chat:** una falla del LLM no impide por sí misma consultar facturas y reglas o resolver solicitudes humanas existentes por la interfaz normal. El chat depende de un solo modelo seleccionado por OLI; el canal Telegram transforma ciertos errores de conversación en un mensaje de fallo y pide al usuario escribir de nuevo, evitando reintentos caros automáticos. [Telegram](../apps/api/worker/telegram.js), [conversación Telegram](../apps/api/worker/telegram-chat.js), [correo](../apps/api/worker/email.js), [chat](../apps/api/worker/chat.js).

## Qué puede detectar la operación actual

`GET /api/health` comprueba que la API puede consultar D1 con `SELECT 1`; devuelve 503 si esa consulta falla. Un 200 no comprueba R2, colas, saldo, lectores, conversión PDF ni entrega de mensajes. Logs están habilitados y las trazas se muestrean al 1%. No se ve una configuración de alertas o una sonda externa completa dentro de la configuración revisada.

Para uso masivo hacen falta señales accionables: proporción de fallos por dependencia, antigüedad del trabajo pendiente más viejo, volumen de `DEAD`, atrasos de canal, errores de integridad y gasto/saldo de IA. Las sondas deben verificar servicios sin mover dinero y sin generar gasto de IA ilimitado. Debe existir un responsable que reciba y atienda las alertas.

## Pasos de recuperación durante un incidente

1. **Identificar el alcance.** Distinguir servicio completo, lector primario, lectura separada, persistencia o solamente notificación. Revisar estado del proveedor, logs, identificador de factura y trabajo. No usar únicamente `/api/health` para declarar recuperado el flujo.
2. **Comprobar qué quedó guardado.** Consultar decisión, reserva, política, trabajo y error antes de repetir una acción. Si falta respuesta HTTP, conservar su clave de idempotencia. Una decisión confirmada permanece como antecedente.
3. **Corregir la dependencia.** Recuperar saldo/credenciales o disponibilidad; revisar cola, cron y almacenamiento según el incidente. No cambiar modelos ante una lectura incierta para forzar aprobación.
4. **Distinguir trabajo recuperable de terminal.** `PENDING` y `RETRY`, y ejecuciones abandonadas con intentos disponibles, pueden continuar por el mecanismo existente. `DEAD` necesita una recuperación diseñada y auditada. Actualmente no hay un comando general de la aplicación para reabrirlo; no se debe resetear a mano el contador ni borrar su historial.
5. **Resolver inconsistencias antes de reanudar.** Si hubo commit ambiguo o restauración, reconciliar D1 y R2. Si faltó un aviso, reenviar desde la decisión registrada cuando corresponda, sin volver a autorizar.
6. **Verificar la recuperación.** Probar con datos ficticios el componente afectado, confirmar una sola reserva en operaciones repetidas y observar que disminuye el atraso. Conservar evidencia y comunicar al usuario qué facturas siguen pendientes o requieren nueva documentación.

Estos pasos son el procedimiento recomendado. La revisión no ejecuta pausas, reenvíos, restauraciones ni cambios sobre producción.

## Refuerzos necesarios para público masivo

| Prioridad | Refuerzo | Problema que resuelve |
| --- | --- | --- |
| Antes de abrir | Reconciliación de ingreso R2/D1 y prueba de commit ambiguo | Evita que una compensación o un corte dejen referencias sin original |
| Antes de abrir | Recuperación auditada de trabajos terminales y eventos Telegram, con permisos y límites | Permite atender una caída larga sin alterar historial o reiniciar contadores arbitrariamente |
| Antes de abrir | Alertas, sondas por dependencia y responsables de incidentes | Reduce el tiempo entre falla real, detección e intervención |
| Antes de abrir | Ensayo de restauración D1/R2 y objetivos de recuperación y pérdida de datos | Convierte capacidades del proveedor en un procedimiento comprobado para OLI |
| Antes de abrir | Identidad real por usuario/empresa y cuotas globales y por empresa | Sustituye acceso demo y contiene saturación y consumo compartido |
| Al crecer | Revisión del presupuesto de reintentos de notificación y recuperación por canal | Evita reintentos indefinidos y fallos de entrega sin atención |
| Al crecer | Alternativa validada de chat/OCR y una segunda ruta de inferencia si el servicio lo exige | Reduce dependencias comunes; exige mantener lectura independiente y repetir evaluaciones de seguridad |
| Al crecer | Corte temporal de llamadas a proveedores caídos y colas con reparto por empresa | Evita agotar todos los trabajos y el gasto durante una caída sostenida |
| Según objetivos de disponibilidad | Contingencia independiente de plataforma y datos, si se justifica | Atiende una caída amplia de Cloudflare; no se resuelve añadiendo otro dominio |

La URL alternativa `workers.dev` usa el mismo Worker y dependencias. Puede ayudar frente a un problema específico del dominio si se ensaya el acceso y las integraciones, pero no es un respaldo independiente. Revertir una versión del Worker puede resolver un despliegue defectuoso; no revierte por sí solo datos D1/R2 y requiere compatibilidad con el esquema existente. [Rollback de Workers](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).

El criterio para ampliar acceso es conservar las garantías al fallar: sin aprobación por agotamiento, sin doble reserva por reentrega, sin pérdida silenciosa de trabajo aceptado y con una recuperación explicable. Los [escenarios de costo](COSTOS_OLI_20261017.md) deben acompañarse de pruebas de carga y fallos; no certifican capacidad masiva por sí mismos.

## Evidencia y alcance de la verificación

La evidencia incluye hashes de los módulos revisados y resultados de las suites locales de API y extractor en [review-20261017.json](robustness/review-20261017.json). Las pruebas usan documentos ficticios, D1/R2 locales de Miniflare y respuestas externas simuladas. Cubren respaldo de modelos, errores de credenciales/saldo, límites, checkpoints parciales, reentrega, abandono de ejecución, fallo al finalizar D1 y confirmaciones idempotentes. Estas comprobaciones no son métricas de exactitud OCR ni una garantía de la plataforma real.

| Comprobación ejecutada | Resultado | Registro |
| --- | --- | --- |
| Suite API, catorce archivos de pruebas | Proceso exitoso, `exitCode: 0` | [API](robustness/api-tests-20261017.json) |
| Suite extractor, dos archivos de pruebas | Proceso exitoso, `exitCode: 0` | [Extractor](robustness/extraction-tests-20261017.json) |

Los módulos revisados conservaron los mismos hashes durante la verificación. No se modificó el comportamiento del backend para producir este informe.

La ventana de commit ambiguo entre D1/R2, la pérdida de disponibilidad completa de Cloudflare/OpenRouter y la restauración coordinada quedan como escenarios que requieren ejercicios específicos. No se publica un porcentaje de uptime, una puntuación de robustez ni un tiempo de recuperación que no se haya medido.
