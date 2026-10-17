# Integración del frontend de Whady

Dirección compartida: **https://oli30x.ultramare.dev/app**.
La UI y el API `/api/*` comparten el origen `https://oli30x.ultramare.dev`.
El acceso `https://oli-api.tiamat-agency.workers.dev` también sigue disponible.
Contrato canónico: [API.md](API.md), esquemas en `packages/contracts`.
El cliente de `apps/web` ya implementa este contrato. Valida DTOs compartidos y los
proyecta a los componentes existentes mediante `src/api/view-model.ts`; esa proyección
no concede permisos ni calcula decisiones. Ver [operación y tests](../apps/web/README.md).
El listado siguiente documenta los cambios aplicados al cliente original.

## Ajustes concretos en el cliente

- `apps/web/src/api/http-api.ts`: login es `POST /session` con email/password;
  logout es `DELETE /session`. `/auth/login`, `/auth/demo`, `/auth/logout` y `/orgs`
  no existen en P0. La empresa viene de la sesión demo provisionada.
- Leer `data` en respuestas individuales; leer `data` y `pagination` en listados.
  `/me` devuelve `{data: Session}` y `/mandate` devuelve `{data: {active, draft}}`.
  Consumir los DTOs compartidos, sin convertir filas SQL ni buscar formas alternativas.
- Guardar `csrfToken` de la sesión en memoria y enviar `X-CSRF-Token` en mutaciones.
  `X-Requested-With` por sí solo no reemplaza ese token. Usar cookies del mismo origen.
- En subida, activación y revisión, crear un `Idempotency-Key` UUID por acción lógica;
  reutilizarlo al reintentar. Un UUID distinto representa una nueva acción.
- La lista de facturas usa `page`/`pageSize`, no `limit`. La factura tiene `file.url`,
  `latestDecision`, `approvalRequest` y estados RECEIVED/PARSING/READY/PROCESSING/DECIDED/FAILED.
  Decidir `APPROVE` pertenece exclusivamente a `latestDecision.action` confirmado por D1.
- Revisar `expectedDecisionId`, `expectedPolicyVersionId` y comentario al autorizar;
  `/approvals` devuelve pares `{approval, invoice}` y `canApprove` no sustituye la revalidación.
- Procesar puede durar hasta aproximadamente 55 segundos de proveedor/lectura separada;
  ampliar el timeout del comando o recuperar el estado mediante polling. Si la conexión
  expira, consultar antes de volver a pedir procesamiento; no volver a subir automáticamente.
- `/evaluation/summary` devuelve `data: null`; no mostrar una precisión end-to-end ficticia.
  Agent Access, Clearance, chat y delegaciones no tienen endpoints P0.

## Desarrollo y acceso

El proxy Vite ya apunta a `http://localhost:8787`; arrancar `apps/api` con Wrangler,
aplicar migraciones/seed locales y configurar `.dev.vars`. Configurar también
`DEV_WEB_ORIGIN=http://localhost:5173` en `.dev.vars`: el Worker local admite ese
origen explícito únicamente en HTTP/localhost, manteniendo CSRF. El Worker desplegado
no activa esa excepción. Para usar recursos remotos desde la web, servir UI y API bajo
el mismo origen HTTPS; no reescribir arbitrariamente Origin ni desactivar CSRF.

El archivo **local e ignorado** `apps/api/.env.api-demo.json` contiene las credenciales
del Worker remoto. Oscar las comparte por un canal privado. No están en GitHub ni en
el frontend; nunca compartir los secretos OpenRouter ni el token del probe privado.

## Qué probar

1. Sesión → mandato/proveedores/acuerdos → subida → process → lista/detalle → dashboard.
2. `examples/invoices/hosting.pdf` corresponde al acuerdo de USD 200; `accounting.pdf`
   al de USD 450, que requiere revisión con las reglas iniciales. La base remota ya
   conserva los smoke tests y reservas: subir muestras aprobadas de nuevo debe bloquear
   el duplicado. Usar una base local nueva para repetir un recorrido sin antecedentes.
3. Proveedor prohibido, importe fuera de acuerdo, presupuesto insuficiente, duplicado,
   documento incierto y fallos técnicos. BLOCK/ESCALATE son resultados, no errores HTTP.
4. Reintento de subida/autorización con la misma clave; nunca debe duplicar reservas.

PDF usa Mistral OCR y PDF_TEXT separado; layouts no reconocidos y discrepancias escalan.
PNG/JPEG no se autoaprueban mientras falte OCR independiente. Los 50 documentos Aurora
de `fixtures` pertenecen a otra configuración de prueba; no mezclarlos con el seed mínimo.

Validación del backend: 25 tests API/integración, 1 test del Worker empaquetado, 16 del
extractor, 74 del motor, 24 de contratos y 14 de D1. Proveedores simulados en tests locales;
smoke tests vivos registrados aparte en `docs/evaluations/integration-*.json`. La primera
lectura PDF viva escaló por texto concatenado; su decisión se conserva. Tras corregir
el parser se confirmó APPROVE de USD 200 y ESCALATE de USD 450, seguido de autorización
OWNER simulada; reserva total USD 650. Ninguna transferencia de dinero.

## Integración aplicada

- Login/logout por `/session`, CSRF en memoria y errores HTTP tipados.
- Envelopes y paginación canónicos, PATCH de proveedores/acuerdos, presupuesto real.
- Revisión/borrador/política de la configuración que la persona revisó; activación explícita.
- Claves de reintento por acción, process con timeout de 90s, polling limitado y actualización manual.
- Aprobaciones con IDs esperados y permiso del servidor; correcciones sin botón de aprobación.
- PDF privado y decisiones previas conservadas; evaluación sin resultados devuelve null.
- Formulario P0 sin programación ni excepciones de acuerdo que el backend no permite.
- Assets de Vite y API en el mismo Worker/origen HTTPS; mock solo al seleccionarlo explícitamente.

La tabla anterior de tests del backend es su referencia original. El cliente añade seis tests,
incluyendo un recorrido contra el Worker con D1/R2 reales y proveedores simulados.

## Comprobación en navegador (17 de octubre)

Se condujo Chrome sobre la web publicada, sin sustituir el proveedor ni las respuestas HTTP:
login, selección de dos PDF ficticios, procesamiento, detalle y autorización humana de USD450
con comentario. La decisión ESCALATE anterior permanece en el historial; D1 confirma la reserva.
La factura nueva de USD200 quedó en revisión porque el modelo emitió advertencias incluso
sobre características esperadas de una demo. Esas advertencias se conservaron y no hubo
botón para sobreescribirlas. La reserva total de la base pasó de USD650 a USD1100.

El documento privado responde PDF con caché privada; la vista previa usa un Blob efímero,
limitado a 5MiB y revocado al salir, conservando el sandbox del archivo original. Las
comprobaciones y resultados reales se guardan en `docs/evaluations/frontend-browser-20261017.json`.
La activación de reglas y la presentación de FAILED reintentable también se probaron en la
base local aislada; no se modificaron las reglas remotas para conseguir resultados favorables.

La comprobación visual final en Chrome confirmó inicio y detalle a 1440px y 390px
sin overflow horizontal, PDF visible, historial presente, evaluación vacía y ninguna
excepción JavaScript observada. El reporte del navegador conserva esos resultados.
