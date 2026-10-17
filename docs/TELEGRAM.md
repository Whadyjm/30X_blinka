# Telegram en Oli

El usuario abre **Integraciones → Conectar Telegram**, escanea el QR con su teléfono
o pulsa **Abrir Telegram**, y pulsa **Iniciar** en el bot compartido. El QR se genera localmente
en el navegador con el mismo enlace temporal; no se envía a servicios de imágenes externos.
Desaparece al vencer el enlace o completar la conexión. La pantalla consulta el estado mientras el enlace siga vigente y se actualiza
al volver a la pestaña. Permite desconectar con confirmación y conserva las facturas previas.
Cada usuario vincula una cuenta de Telegram a una empresa activa; para cambiarla debe desconectar primero.
La misma empresa puede tener varios usuarios vinculados al bot a la vez. El login demo actual
autentica un único `DEMO_USER_ID`: compartir esas credenciales no crea usuarios independientes.
Para probar varias personas como usuarios distintos se necesita habilitar sus cuentas en la autenticación de Oli.

## Configuración del servicio

- Worker `oli-api`, cuenta Tiamat (`fbaa64f96579f93b2db32a1eb12ff6c9`).
- Secretos `TELEGRAM_BOT_TOKEN` y `TELEGRAM_WEBHOOK_SECRET`; nunca se envían al navegador.
- `PUBLIC_APP_URL=https://oli30x.ultramare.dev` fija la URL del webhook y los enlaces a facturas.
- Cola `oli-telegram`, binding `TELEGRAM_QUEUE`, consumidor del mismo Worker.
- Aplicar las migraciones, incluida `0006_telegram_conversations.sql`, antes del despliegue.

El primer intento de vinculación consulta `getMe` y registra `setWebhook` desde el servidor.
No necesita que el usuario configure direcciones, pegue credenciales ni conozca el token de BotFather.
El registro conserva eventos pendientes y solicita mensajes y pulsaciones de botones
(`allowed_updates: ['message', 'callback_query']`). En un bot ya conectado, el operador puede
refrescar el webhook con `POST /api/v1/integrations/telegram/setup` (OWNER, sesión y CSRF);
no se desconecta a ningún usuario.

## API autenticada

Todas las rutas usan sesión; POST y DELETE requieren Origin permitido y X-CSRF-Token.
Los tipos y validadores se encuentran en `@oli/contracts`.

| Método | Ruta bajo `/api/v1` | Respuesta |
| --- | --- | --- |
| GET | `/integrations/telegram` | `{ data: { available, connection: null \| { id, displayName, connectedAt } } }` |
| POST | `/integrations/telegram/link` | `201 { data: { url, expiresAt } }` |
| POST | `/integrations/telegram/setup` | `204` (solo OWNER; refresca webhook compartido) |
| DELETE | `/integrations/telegram` | `204` |

`available` indica que existen secretos y bindings; el POST valida la conexión real con Telegram.
El enlace dura cinco minutos, usa 32 bytes aleatorios y solo su SHA-256 se guarda en D1.
Generar otro invalida los enlaces pendientes del mismo usuario y empresa. El enlace no debe compartirse.
Una vinculación consumida no autoriza otra identidad ni puede reactivarse después de desconectar.

## Recepción y garantías

`POST /api/channels/telegram/webhook` verifica `X-Telegram-Bot-Api-Secret-Token` antes de leer el evento.
Solo acepta chats privados de personas; no resuelve identidad mediante nombres, archivos o mensajes reenviados.
Guarda un recibo por `update_id` y confirma a Telegram después de encolarlo.
Si falla la cola responde 503 para que Telegram reintente. La cola transporta únicamente el ID del recibo.
Los códigos de vinculación se transforman a hashes antes de persistir el mensaje.

La identidad de conexión se fija al recibir el evento y se comprueba otra vez al procesar.
Desconectar cancela enlaces pendientes, invalida la conexión y evita descargas/respuestas financieras pendientes.
Un trabajo financiero que ya estaba ejecutándose puede terminar y conservar su registro.

PDF, PNG y JPEG usan el ingreso compartido con la web, con el mismo máximo de 5 MiB,
validación de bytes, hash de servidor y almacenamiento privado. `invoice_sources` registra el origen
`TELEGRAM` sin reconstruir la tabla financiera ni modificar sus triggers. El API presenta ese origen
y conserva `HUMAN_UPLOAD` para los documentos anteriores. Origen, auditoría e idempotencia se confirman
en el mismo batch que crea la factura.

El consumidor usa un lease y la operación idempotente del recibo. Repetir un evento no crea otra factura;
enviar nuevamente el mismo archivo como un mensaje nuevo sí crea una entrada y el motor comprueba duplicados.
La extracción, corroboración, política y reserva atómica son las existentes. Las imágenes continúan
requiriendo revisión mientras no haya OCR independiente. No hay pagos reales ni aprobación por comandos.

La respuesta final cuenta en primera persona qué llegó y qué ocurrió, con un motivo breve
y un botón al detalle privado. `worker/telegram-invoice.js` traduce la acción y los motivos
registrados a lenguaje cotidiano; no vuelve a decidir ni llama a otro modelo. Oculta referencias
provisionales, URLs largas y vistas previas de enlaces. Los resultados de cambios confirmados
usan el mismo resumen. El detalle auditable permanece en la factura.
Un error de notificación
reintenta la respuesta guardada sin reevaluar la factura. Telegram no ofrece una clave idempotente para
`sendMessage`: una caída después de enviar y antes de confirmar puede repetir una notificación, pero no
sus efectos financieros. Tras cinco intentos fallidos el recibo queda FAILED en D1 y emite un log estructurado;
si la factura ya fue registrada, su estado sigue disponible en la web.

## Comprobaciones

`apps/api/tests/telegram.test.mjs` usa D1/R2 locales y Telegram/extracción simulados para comprobar autenticación,
CSRF, códigos vencidos/consumidos, aislamiento de empresas, revocación, límites, duplicados y reintentos.
Estos tests no miden precisión del extractor ni prueban entrega real desde una cuenta personal de Telegram.

## Conversación

Los mensajes de texto de una conexión activa llaman al mismo `chatMessage` de la web,
con el rol y empresa obtenidos de D1, no del texto de Telegram. «Hola», preguntas y
seguimientos usan el modelo y las herramientas acotadas de `chat-tools.js`; no hay SQL libre.
El prompt común está en `apps/api/worker/chat-prompt.js` (versión `chat-v2`): limita el tema
a Oli y finanzas de la empresa, exige consultar registros actuales y prohíbe ejecutar pagos.
Esa instrucción orienta al modelo; el aislamiento de datos y los permisos se aplican en el servidor.

Cada conexión tiene su conversación privada y la última factura enviada como contexto.
Desconectar y volver a conectar crea un contexto nuevo. Se conservan seis turnos completos
para el modelo; texto de hasta 4000 caracteres y el mismo límite de 20 intentos por usuario/empresa
cada 15 minutos que en web. No se interpretan audios. Las respuestas largas se dividen en mensajes.

El modelo solo puede preparar propuestas. Telegram muestra los datos almacenados por el servidor
y botones **Confirmar / Cancelar**; un «sí» escrito no ejecuta nada. Cada botón está vinculado a
la conexión y al mensaje concreto que recibió la propuesta. El callback verifica de nuevo identidad,
rol, vigencia y revisión de datos mediante los mismos servicios `confirmAction` / `cancelAction`.
Esto no permite aprobar facturas por encima de las reglas ni sustituir revisión de extracción incierta.

La respuesta se guarda antes de enviarla y se registra cada parte entregada: un reintento de
notificación no vuelve a gastar en el modelo ni repite una mutación. Persiste la limitación de
Telegram: una caída entre su aceptación y el registro local puede repetir un mensaje.
