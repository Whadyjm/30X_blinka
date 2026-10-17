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
- Aplicar la migración `0004_telegram.sql` antes del despliegue.

El primer intento de vinculación consulta `getMe` y registra `setWebhook` desde el servidor.
No necesita que el usuario configure direcciones, pegue credenciales ni conozca el token de BotFather.
El registro conserva eventos pendientes y solicita únicamente mensajes nuevos (`allowed_updates: ['message']`).

## API autenticada

Todas las rutas usan sesión; POST y DELETE requieren Origin permitido y X-CSRF-Token.
Los tipos y validadores se encuentran en `@oli/contracts`.

| Método | Ruta bajo `/api/v1` | Respuesta |
| --- | --- | --- |
| GET | `/integrations/telegram` | `{ data: { available, connection: null \| { id, displayName, connectedAt } } }` |
| POST | `/integrations/telegram/link` | `201 { data: { url, expiresAt } }` |
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

La respuesta final incluye decisión, explicación y enlace privado a la factura. Un error de notificación
reintenta la respuesta guardada sin reevaluar la factura. Telegram no ofrece una clave idempotente para
`sendMessage`: una caída después de enviar y antes de confirmar puede repetir una notificación, pero no
sus efectos financieros. Tras cinco intentos fallidos el recibo queda FAILED en D1 y emite un log estructurado;
si la factura ya fue registrada, su estado sigue disponible en la web.

## Comprobaciones

`apps/api/tests/telegram.test.mjs` usa D1/R2 locales y Telegram/extracción simulados para comprobar autenticación,
CSRF, códigos vencidos/consumidos, aislamiento de empresas, revocación, límites, duplicados y reintentos.
Estos tests no miden precisión del extractor ni prueban entrega real desde una cuenta personal de Telegram.
