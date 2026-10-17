# Whady: conectar el inicio conversacional de Oli

Ask Oli consume el chat real con este contrato: historial privado, adjuntos recibidos antes del mensaje, tarjetas del servidor y propuestas que requieren confirmación explícita. El prototipo [/propuesta/](https://oli30x.ultramare.dev/propuesta/) sigue como referencia visual independiente. La versión unificada está publicada en `main` y desplegada en `oli30x.ultramare.dev`; la consulta real de presupuesto desde Home respondió con una tarjeta del servidor. [Comprobación de producción](evaluations/unified-release-production-20261017.json) y [regresiones locales y límites](evaluations/frontend-integration-fixes-20261017.json).

Backend: `/api/v1`, misma sesión/cookie y `X-CSRF-Token` en memoria. Modelo fijo `deepseek/deepseek-v4.1-flash`, clave exclusivamente en el Worker. Las reglas, lecturas y cambios de D1 son responsabilidad del servidor.

Publicado en `https://oli30x.ultramare.dev` con migración0003 aplicada. La comprobación
con DeepSeek real consultó presupuesto, propuso un proveedor ficticio desautorizado,
esperó confirmación, conservó el resultado al repetirla y editó la referencia del
proveedor mediante otra confirmación. Facturas, decisiones y reservas financieras
existentes no cambiaron. Evidencia: [conversation-live-20261017.json](evaluations/conversation-live-20261017.json).
El recorrido de alta desde factura y su reevaluación está probado localmente con D1/R2
reales y extracción simulada; no se presenta como medición OCR en producción.

## Tarea lista para implementar

- [x] Métodos usados por Home tipados y validados con `@oli/contracts`: mensajes, conversaciones, historial, intake y consulta/confirmación/cancelación de propuestas. El alta directa por formulario con `POST /chat/actions` sigue pendiente; el modelo puede preparar la propuesta y Home permite revisarla y confirmarla.
- [x] Composer con texto, sugerencias, adjuntos removibles y drag/drop. Reutilizar `<Oli />` del paquete de la mascota; sin botón play/pausa.
- [x] Guardar el `conversationId` retornado, recuperar historial y distinguir turnos fallidos/en curso. El frontend nunca envía el historial ni roles al modelo.
- [x] Renderizar texto seguro y tarjetas según `type`, usando cifras/estados de las tarjetas como hechos. No interpretar el texto del asistente como una orden ejecutada.
- [ ] Flujo proveedor desconocido: explicar el bloqueo, recoger datos de proveedor/acuerdo y mostrar confirmación explícita. Mantener la factura original.
- [x] Mostrar antes/después de las propuestas, vencimiento y botones Confirmar/Cancelar. Tras confirmar, usar el resultado del servidor y refrescar las queries afectadas.
- [x] Mantener lista/estados/gráfico y botón de carga clásicos. Los datos de ejemplo del prototipo no se importan a la app.
- [ ] Comprobar móvil, teclado, carga/fallo/reintento y que los datos inciertos o proveedores prohibidos no tengan un atajo para aprobar.

## Rutas y esquemas

| Método/ruta | Entrada | Salida `data` |
|---|---|---|
| `POST /chat/messages` | `ChatMessageInputSchema` + `Idempotency-Key` | `ChatReplySchema` |
| `GET /chat/conversations` | `channel=WEB|TELEGRAM`, por defecto `WEB` | `ChatConversationsSchema`, últimas 20 del usuario/empresa/canal; cada fila incluye `channel` y `title` |
| `GET /chat/conversations/:id` | Sin body | `ChatHistorySchema`, últimos 20 turnos en orden cronológico |
| `GET /invoices/:id/intake` | Sin body | Tarjeta `ChatCardSchema` con `type=INVOICE` |
| `POST /chat/actions` | `ChatActionInputSchema` + `Idempotency-Key` | `ChatActionSchema`, `201` |
| `GET /chat/actions/:id` | Sin body | `ChatActionSchema` con estado actual |
| `POST /chat/actions/:id/confirm` | `{ "confirmed": true }` + `Idempotency-Key` | `ChatActionResultSchema` |
| `POST /chat/actions/:id/cancel` | Sin body | `ChatActionSchema` |

Todas las mutaciones requieren CSRF. Solo OWNER prepara/confirma/cancela cambios. APPROVER puede conversar y consultar, sin herramientas de escritura. Conversaciones y acciones son privadas para el mismo usuario y empresa; IDs de otro usuario devuelven404. Los listados de conversaciones y su historial tienen un límite fijo, sin envelope de paginación P0.

Ask Oli mantiene dos pestañas con selección y queries independientes. `ChatHistorySchema`
incluye `channel`; Web conserva borrador y adjuntos al consultar Telegram. Telegram es
una vista del historial con enlace al bot y sin botones de confirmar/cancelar. El servidor
rechaza escribir o reutilizar una clave Telegram desde Web con `CHAT_CHANNEL_MISMATCH`409.
Web presenta las conversaciones como subpestañas debajo de los canales; en móvil la fila
se desplaza horizontalmente. El botón + abre una conversación nueva, persistida al enviar
su primer mensaje. Cada hilo conserva su borrador y adjuntos en memoria mientras Home
permanece abierto. La × cierra la pestaña sin borrar historial: el icono de conversaciones
cerradas permite recuperarla. Se recuerda el cierre por usuario/empresa en este navegador;
el servidor conserva los mensajes. Cerrar el último hilo deja una conversación nueva.
Durante un turno pendiente los controles de cierre quedan deshabilitados. Telegram abre
su conversación más reciente sin subpestañas ni selector.
La migración0009 separa el legado mezclado mediante una proyección append-only; conserva
los snapshots originales y el contexto al modelo usa exclusivamente el canal del hilo.

El menú separa **Ask Oli** (`/app`) de **Dashboard** (`/app/dashboard`). Dashboard conserva
el resumen, métricas, bandeja, actividad, presupuesto y vencimientos antes mostrados debajo
del chat. `/app/chat` redirige a Ask Oli. El chat ocupa su propia pantalla y no depende de
que la consulta de facturas del dashboard termine correctamente.

El chat móvil ocupa el espacio disponible sobre el teclado mediante `visualViewport`;
el historial tiene scroll propio y el compositor permanece al pie. El texto del asistente
usa Markdown acotado, sin HTML ni imágenes remotas. El prompt `chat-v3` pide respuestas
breves y preguntas progresivas en lenguaje cotidiano, sin nombres de campos de programación.
El compositor usa una sola fila de 54px con clip, texto y envío; crece con varias líneas
hasta 144px de texto y mantiene los archivos en una fila aparte cuando hay adjuntos.

## Mensajes y adjuntos

Primera solicitud:

```json
{ "conversationId": null, "text": "¿Cómo va mi presupuesto?", "invoiceIds": [] }
```

Siguientes solicitudes usan el `conversationId` retornado. `text`: máximo4000 caracteres; `invoiceIds`: hasta4 IDs propios. Se exige texto o al menos una factura. Una clave UUID por turno; si se pierde la respuesta, repetir exactamente el mismo body y clave. No regenerar la clave ni añadir el nuevo conversationId en ese reintento.

Los archivos siguen el flujo existente: `POST /invoices` (multipart, un archivo por solicitud, máximo5MiB), `POST /invoices/:id/process` y polling por ID. Cada archivo mantiene su propia clave de subida. Conservar los IDs y enviarlos al chat: no poner base64, texto OCR o supuestas extracciones en el mensaje. El chat inspecciona los IDs; no inicia llamadas OCR por una instrucción del modelo. Una factura aún procesándose muestra `PROCESSING`; el frontend termina el polling y consulta `/intake` otra vez.

V1 responde JSON al finalizar; no hay streaming/SSE. Usar un timeout de60s para mensajes y el timeout de90s de procesamiento existente. Mientras espera, Oli puede mostrar `thinking`; escribir/enfocar usa `listening`, terminar `understanding` y reposo `idle`. Son estados visuales, no una fuente de decisiones financieras.

Límites backend: tres rondas de modelo, cuatro herramientas por turno,35s de presupuesto de proveedor, respuestas de1500 tokens por llamada. Una conversación admite un turno activo. Se conservan claims de reintento: hasta tres intentos por turno y20 intentos por usuario/empresa cada15min. El contexto al modelo incluye los últimos seis turnos completos; la UI recibe hasta20.

## Tarjetas del servidor

`ChatReplySchema` trae `{ conversationId, turnId, text, cards, actions, createdAt, model }`.

| `card.type` | Mostrar |
|---|---|
| `INVOICE` | DTO completo de factura, historial, estado `intake` y sugerencias de alta |
| `INVOICES` | Hasta20 facturas y aviso cuando `truncated=true` |
| `VENDORS` / `AGREEMENTS` | Directorio real, flags y aviso de truncamiento |
| `BUDGET` | Periodo, límite, reservado y disponible por moneda; puede estar vacío |
| `SPEND` | Totales separados por moneda, cantidad, importes extraídos, aprobados y bloqueados |

`SPEND` usa periodo de servicio y, si no está presente, mes de emisión (`periodBasis`). `amountBasis=EXTRACTED_AMOUNTS_NOT_PAYMENTS`: los importes de documentos inciertos no se vuelven verificados por entrar en una suma. La consulta opcional es una subcadena literal de proveedor/concepto, no una categoría financiera certificada. No mezclar monedas ni representar estas cifras como transferencias. `totals=[]` significa sin registros coincidentes; mostrar esa ausencia.

No insertar HTML generado por el modelo. Texto plano o Markdown saneado, enlaces de navegación propios y `invoice.file.url` para documentos privados. Las cifras del prototipo no son el fallback de un error de red.

## Factura y proveedor

Después de procesar, consultar `GET /invoices/:id/intake`:

- `KNOWN_VENDOR`: el proveedor se reconoce exactamente; el procesamiento ya aplicó las reglas. Si `canResume=true`, la factura fue bloqueada antes de que existiera su proveedor: ofrecer «Volver a revisar» con una propuesta `RESUME_INVOICE`.
- `UNKNOWN_VENDOR` + `canOnboard=true`: «No encuentro a [nombre] entre tus proveedores. ¿Quieres registrarlo?». Acciones «Agregar proveedor» y «Dejar bloqueada». Registrar exige OWNER y confirmación; cerrar la propuesta no modifica la factura.
- `DISALLOWED_VENDOR`: mostrar el bloqueo y motivo, sin botón de crear un duplicado o aprobar.
- `AMBIGUOUS_VENDOR` / `EXTRACTION_REVIEW`: solicitar aclaración/documento corregido, sin alta automática ni excepción de aprobación.
- `PROCESSING` / `FAILED`: seguir los estados y reintentos existentes. No crear un proveedor a partir de una lectura fallida.

Las sugerencias de `intake.suggestedAgreement` son datos extraídos, no términos comerciales confirmados. Recoger nombre, `allowed`, referencia opcional, concepto, moneda, importe en unidades menores, tolerancia, pago único/mensual y acuerdo activo. No deducir frecuencia/tolerancia ni permiso de una factura. El nombre de alta debe coincidir exactamente con el leído (normalización de caja/espacios/NFC); corregir la identidad leída requiere un documento corregido. Si el mandato exige acuerdo, el servidor pide uno activo que resuelva el concepto/moneda de la factura.

Ejemplo: preparar la acción desde formulario inline, usando el `expectedDecisionId` mostrado por intake:

```json
{
  "kind": "ONBOARD_INVOICE_VENDOR",
  "invoiceId": "ID_DE_LA_FACTURA",
  "expectedDecisionId": "ID_DE_LA_DECISION_REVISADA",
  "vendor": { "name": "Faro Telecom Demo", "allowed": true, "externalRef": null },
  "agreement": {
    "currency": "USD", "amountMinor": 8900, "toleranceMinor": 0,
    "frequency": "MONTHLY", "concept": "Internet ficticio", "active": true
  }
}
```

El modelo también puede preparar esa propuesta cuando ya cuenta con los datos que el usuario dio. En ambos casos la UI muestra los mismos campos de `action.proposal`; `before` contiene el registro previo para UPDATE. Acción `PENDING` tiene diez minutos de validez. No sustituir sus datos o IDs por versiones actuales al pulsar confirmar.

Botón: **Registrar proveedor y volver a revisar**. Envía exclusivamente `{confirmed:true}` al ID de acción. El servidor registra proveedor/acuerdo, resuelve IDs nulos de la misma factura y evalúa todas las reglas en un batch atómico. La decisión previa permanece. Si resulta `APPROVE`, D1 reserva una sola vez; si requiere una persona, devuelve una solicitud de revisión real. No mostrar un éxito financiero hasta recibir el resultado confirmado.

Otros tipos: `CREATE_VENDOR`, `UPDATE_VENDOR`, `CREATE_AGREEMENT`, `UPDATE_AGREEMENT`, `RESUME_INVOICE`; sus formas exactas están en `ChatActionInputSchema`. No hay herramientas de borrar, pagar, activar mandato ni confirmar una propuesta desde el modelo. Los endpoints existentes de reglas y revisión humana se conservan.

## Confirmación, historial y errores

`ChatActionResultSchema` devuelve `{ action, vendor, agreement, invoice }`; los campos que no participan son null. Confirmar dos veces la misma acción devuelve el resultado guardado, sin repetir efectos, incluso con otra clave. La UI sigue conservando una clave por intención. Antes de habilitar una acción recuperada del historial, refrescar su estado con GET: los replies/historial son snapshots históricos y pueden contener una acción que entonces estaba pendiente.

Invalidar `qk.vendors`, `qk.agreements`, `qk.invoices`, `qk.invoice(id)`, `qk.approvals` y `qk.mandate` según el resultado. El presupuesto se obtiene dentro de `getMandate()`; refrescar además el dashboard si se muestra.

| Código | Comportamiento frontend |
|---|---|
| `CHAT_IN_PROGRESS`409 | Esperar; repetir el mismo turno/body/clave si se perdió la respuesta. No mandar un turno nuevo en paralelo |
| `CHAT_RETRY_LIMIT`409 | Mostrar fallo conservado; no reintentar automáticamente |
| `ACTION_STALE`409 | Datos cambiaron; preparar una propuesta nueva y pedir revisión otra vez |
| `ACTION_NOT_PENDING`409 | Refrescar acción: cancelada o vencida no se ejecuta |
| `DECISION_CHANGED`409 | Volver a consultar intake; no sustituir el ID silenciosamente |
| `AGREEMENT_REQUIRED`409 | Pedir términos del acuerdo faltante/incompatible |
| `VENDOR_ONBOARDING_NOT_ALLOWED`409 | Refrescar intake; no mostrar un atajo para aprobar |
| `VENDOR_IDENTITY_MISMATCH`400/409 | Aclarar identidad; no crear otro nombre para sortear el bloqueo |
| `RATE_LIMITED`429 | Conservar texto y esperar, sin bucle de reintentos |
| `CHAT_PROVIDER_UNAVAILABLE`, `CHAT_TIMEOUT`, `CHAT_UNAVAILABLE` | Mensaje recuperable; mantener documentos y no simular una respuesta |

Los errores conservan el envelope común `{error:{code,message,fieldErrors,requestId}}`. Una respuesta de modelo que se interrumpe no guarda sus propuestas. Crear/editar proveedores no implica reevaluar todas las facturas: V1 solo retoma explícitamente el caso de proveedor antes desconocido, sin reserva previa y con IDs originalmente nulos. No es un endpoint de reevaluación general.

## Criterios de aceptación

1. Un proveedor conocido permitido sigue el pipeline, sin sugerencia de alta.
2. Uno desconocido genera propuesta; antes de confirmar no existe proveedor ni acuerdo nuevo en D1.
3. Tras confirmar, la factura mantiene su ID y primera decisión; puede aprobar, bloquear o escalar según reglas vigentes.
4. Repetir clic, perder la respuesta o cambiar de pestaña no duplica proveedores, decisiones o reservas.
5. Proveedor prohibido, extracción incierta, otro usuario/empresa, política obsoleta o propuesta vencida nunca se saltan con el chat.
6. Una consulta sin datos históricos explica la ausencia y nunca muestra los importes ficticios del prototipo.

Pruebas backend: `apps/api/tests/chat.test.mjs`. La prueba de modelo local es simulada; los resultados de integración con el proveedor real se registran por separado.
