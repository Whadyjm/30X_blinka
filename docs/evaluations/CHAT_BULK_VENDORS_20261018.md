# Alta de proveedores por lote y explicación de límites

Publicado en `oli30x.ultramare.dev`, Worker `7cfe0cde-3f97-490c-978e-50572b87f041`,
fuente `72d1d0473032237b1a36089d18b0637b6644d22c`.

`CREATE_VENDORS` permite preparar entre uno y veinte proveedores con una sola llamada
a `prepare_change` y una sola tarjeta. Web y Telegram muestran cada nombre y permiso;
solo la confirmación humana autenticada aplica el lote completo. Nombres normalizados
repetidos o existentes rechazan el lote sin modificar permisos. Se conservan la revisión,
la caducidad, OWNER, CSRF, aislamiento por empresa e idempotencia. Las altas, confirmación
y auditoría se guardan juntas; un fallo revierte el lote entero. No cambia acuerdos,
decisiones financieras, reservas ni el motor de facturas.

`CHAT_TOOL_LIMIT` conserva su código técnico e incorpora mensajes diferentes para el
máximo de cuatro consultas/propuestas y el agotamiento de tres rondas. Explican por qué
no se terminó, que no se ejecutó ningún cambio y cómo continuar mediante lotes de hasta
veinte proveedores o tareas más pequeñas. Telegram conserva el mensaje y el historial web
también presenta una explicación legible.

## Verificación

- API: **144/144**, contratos: **29/29**, web: **53/53**, Worker empaquetado: **1/1**.
- Typecheck de contratos y web, compilación de web y dry-run del Worker correctos.
- Pruebas específicas: trece proveedores pendientes sin mutación, confirmación y replay,
  permisos explícitos, límites del lote, nombres repetidos/existentes, cancelación y
  cambios de revisión, fallo deliberado en la segunda alta con rollback de la primera,
  ambas causas del límite y ausencia de propuestas parciales. Telegram prueba lista,
  botones y confirmación repetida; web prueba nombres completos y errores del historial.
- La corrida API inicialmente paralela falló en cuatro casos con errores de conexión
  local y timeouts de workerd/Miniflare. Se conserva `/tmp/oli-bulk-api-tests.log`.
  La corrida completa serial pasó sin modificar el producto para ocultar esos fallos;
  resultado en `/tmp/oli-bulk-api-serial.log`.

La [prueba real del chat y navegador](chat-bulk-vendors-live-20261018.json) usa una
empresa ficticia nueva aislada. El modelo remoto preparó una sola propuesta con los
trece proveedores exactos del paquete manual, todos con los permisos solicitados.
La tarjeta se verificó a 1440 y 390 px, sin desbordamiento horizontal ni errores JS.
La propuesta se canceló y se revocó la sesión temporal: **cero proveedores creados y
cero reservas** en esta prueba publicada. La confirmación del lote sí está cubierta en
las pruebas locales con D1 y en Telegram simulado; no se afirma una confirmación real
de producción que no se ejecutó.

El [manifest de publicación](chat-bulk-vendors-release-20261018.json) registra fuentes
y comprobaciones. Se publicó desde una copia aislada del commit base más los dieciséis
archivos propios; los cambios concurrentes de AskOli y del renderer de la mascota quedaron
fuera. Esta validación corresponde al chat, no es una nueva medición OCR ni cambia los
resultados históricos de las facturas.
