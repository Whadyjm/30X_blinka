# Correo de Oli e inbox

En **Integraciones → Correo de Oli**, un propietario habilita una dirección por empresa,
con identificador aleatorio de 128 bits. La comparte con proveedores; no se conecta Gmail.
El correo aparece en **Bandeja de entrada** y en Home. Los documentos se revisan mediante
el pipeline existente. Al terminar se avisa por Telegram a las conexiones de la empresa
que estaban activas al recibirlo. Una conexión nueva no hereda avisos históricos y una
conexión revocada no recibe respuestas pendientes. La última factura notificada queda
como contexto para continuar la conversación.

## Servicio

- Worker `oli-api`, cuenta Tiamat y dominio `ultramare.dev`.
- `EMAIL_BASE_ADDRESS=oli@ultramare.dev`; regla literal `oli@ultramare.dev` del campo
  `addresses` de Wrangler y **subaddressing** habilitado en Email Routing. El sufijo
  `+identificador` se conserva en `message.to` y resuelve la empresa desde D1.
- Cola `oli-email` / `EMAIL_QUEUE`, mismo Worker. El cron existente recupera recibos cada
  minuto; la finalización de un job de factura también despierta su notificación.
- Aplicar `0008_email_inbox.sql` antes de desplegar. No sustituir MX, reglas previas ni
  catch-all. No se requiere Email Sending ni SMTP saliente.
- `email()` es el único ingreso: no hay endpoint HTTP público para simular remitentes.

## Garantías y alcance

El destinatario SMTP selecciona la empresa; nombres, From/To de cabeceras, asuntos y
documentos no conceden permisos. El remitente es dato, no prueba de identidad. El cuerpo
y HTML no se almacenan ni ejecutan; solo se conserva su hash para deduplicación, remitente
SMTP, asunto, fecha y metadatos. MIME se parsea con `postal-mime` y límites de profundidad,
partes y cabeceras. Se admiten cuatro PDF/JPEG/PNG de 5 MiB cada uno, 8 MiB en total y
correo de 12 MiB. El tipo se verifica con los bytes y se ignoran logos inline.

Hay un límite atómico de veinte correos nuevos por empresa por hora. R2 privado y recibo
D1 se confirman antes de encolar. La reentrega combina hashes del servidor y contenido:
`Message-ID` por sí solo no deduplica. Cambiar cabeceras de transporte no duplica el recibo.
Un nuevo correo con el mismo PDF conserva entrada auditable; el motor comprueba duplicados.

Se reutilizan `receiveInvoice`, la cola de facturas, clasificación, corroboración, política
y reserva atómica. Un comprobante no se convierte en factura ni una lectura incierta
autoriza aprobación. La procedencia EMAIL es append-only en `email_invoice_sources`;
`invoice_channel_sources` combina procedencia sin reconstruir tablas financieras.

El inbox distingue RECEIVED, WAITING, COMPLETED, NO_DOCUMENT y FAILED. Sin adjuntos
compatibles no hay extracción ni aprobación. Esta versión requiere adjuntar el documento:
no sigue enlaces, abre ZIP/Office ni convierte facturas del cuerpo del correo.
Los avisos usan decisiones registradas. Cursor por partes evita reenviar lo ya registrado
al reintentar Telegram, sin repetir extracción ni efectos financieros. Una caída entre
aceptación remota y registro local puede repetir una notificación. Los adjuntos temporales
se eliminan al terminar; los originales de facturas permanecen en R2 privado.

Pausar rechaza correo nuevo y detiene ingreso/avisos pendientes; las facturas ya ingresadas
conservan historial. Reanudar conserva la dirección.

## API

Sesión en todas las rutas; mutaciones con Origin y CSRF. Habilitar/pausar requiere OWNER.
Contratos canónicos: `EmailIntegrationSchema`, `InboxSchema` e `InboxMessageSchema`.

| Método | Ruta `/api/v1` | Resultado |
| --- | --- | --- |
| GET | `/integrations/email` | `{ data: EmailIntegration }` |
| POST | `/integrations/email` | Habilita y devuelve dirección estable por empresa |
| DELETE | `/integrations/email` | Pausa, `204` |
| GET | `/inbox` | `{ data: { messages, unreadCount } }`, últimos 50 mensajes |
| POST | `/inbox/:id/read` | Lectura personal idempotente, `204` |

Lecturas por usuario; mensajes y documentos privados por empresa. La UI consulta cada
cinco segundos, muestra contador de no leídos y tres mensajes recientes en Home.
Asuntos y nombres se renderizan como texto, nunca HTML. Los documentos abren su detalle
privado con decisión e historial existentes.

## Pruebas

`tests/email.test.mjs` usa D1/R2 locales y proveedores simulados para MIME, auth/CSRF,
límites, aislamiento, reentregas, reservas, clasificación y recuperación/revocación.
`tests/runtime.mjs` ejecuta Worker empaquetado, email, colas, lectura, inbox y Telegram en
workerd mediante un harness exclusivo del directorio ignorado `.wrangler/runtime`.
Esto no mide precisión del lector ni demuestra entrega SMTP externa por sí solo.

Validación del 17 de octubre de 2026: 105 pruebas API y 8 de contrato web pasan;
build de producción y recorrido del bundle en workerd pasan. Revisión independiente
de Inbox, Integraciones y Home en 1440 y 390 px, con copia, lectura de mensajes,
enlaces privados y recuperación de pausa verificados en navegador. Sin cambios
al sistema visual existente. No son métricas de precisión del extractor.

Desplegado como `09c2447f-04d8-4dd9-829b-eba9f9b1c0ae`, preservando el parser
`labelled-v5` que ya estaba en producción por trabajo concurrente. Migración, cola,
regla de correo y subaddressing activos; reglas previas y catch-all conservados.
Health, sesión, dirección, Inbox y Telegram existente comprobados en producción;
Integraciones y Bandeja abren sin errores de navegador. La entrega de un correo
SMTP externo todavía requiere la prueba desde el proveedor.
