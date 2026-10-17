# Oli API

Backend P0 del reto en la cuenta **Tiamat** (`fbaa64f96579f93b2db32a1eb12ff6c9`).
App compartida: **https://oli30x.ultramare.dev/app**; API en ese mismo origen, bajo `/api`.
Worker alternativo: https://oli-api.tiamat-agency.workers.dev. Contrato: [docs/API.md](../../docs/API.md).

Conversación con DeepSeek V4.1 Flash usando el mismo `OPENROUTER_API_KEY`: herramientas
de consulta y propuestas confirmables; historial privado, límites de uso y alta guiada
de proveedor con reevaluación acotada de la factura original. Requiere migración0003.
Ver [contrato y tarea de Whady](../../docs/CONVERSATION_FRONTEND_HANDOFF.md).
La UI de conversación aún debe conectarse; `/propuesta/` conserva sus datos de ejemplo.

Implementa sesión demo con cookie HttpOnly/CSRF, reglas y activación OWNER, proveedores,
acuerdos, presupuestos, subida privada R2, listado/detalle/preview, procesamiento,
revisión humana, dashboard y evaluación vacía. La UI de Whady debe conectarse a estas rutas.

PDF se extrae mediante OpenRouter con Mistral OCR y se contrasta con una lectura separada
PDF_TEXT de Cloudflare. El parser de texto acepta etiquetas explícitas conocidas; documentos
escaneados/layouts no reconocidos y cualquier discrepancia se escalan. PNG/JPEG se extraen,
pero **no se autoaprueban sin OCR independiente**, que sigue pendiente. Un segundo mensaje
al mismo modelo no cuenta como corroboración.

El motor recibe únicamente datos de la empresa de la sesión. Antes de guardar se comprueba
la revisión del snapshot en el mismo batch D1. Los triggers existentes crean reserva y contador
atómicamente; no hay un segundo incremento en JS. Procesar otra vez devuelve el resultado;
una petición concurrente devuelve 202. Una ejecución interrumpida admite recuperar el trabajo
tras 120 segundos sin aceptar escrituras del ejecutor antiguo. Las decisiones son append-only.

Primero instalar los paquetes enlazados desde la raíz del repo:

```sh
pnpm --dir packages/contracts install --frozen-lockfile
pnpm --dir packages/extraction install --frozen-lockfile
pnpm --dir packages/domain install --frozen-lockfile
```

Después, desde esta carpeta:

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm deploy
```

## Base D1

Base remota **`oli-demo`**, ID `349afff1-8b3b-4673-929b-ce6936c68d3a`, vinculada
como `env.DB` en `wrangler.jsonc`, dentro de la cuenta de Tiamat. Migración
`0001_initial.sql` y seed demo aplicados el 16 de octubre de 2026 (UTC−4).
La migración `0002_processing_sessions.sql` agrega sesiones, control de intentos y revisión
de snapshot (17 tablas de aplicación en total). Contiene empresa ficticia, dos usuarios demo,
tres proveedores, dos acuerdos, mandato v1 y presupuesto de USD 2000 del periodo
`2026-10`. Los smoke tests de integración agregan facturas, decisiones y reservas simuladas
reales; no se reinicia la base después de medirlas. El seed no fabrica decisiones.

Las migraciones se mantienen en `../../packages/database/migrations`, sin copiarlas.
Desarrollo local usa una base independiente; no activa acceso remoto a D1 por defecto.

```sh
pnpm db:migrate:local
pnpm db:seed:local
pnpm test
pnpm test:runtime
pnpm types
```

`db:seed:local` solo se ejecuta una vez por base local nueva. Para futuras
migraciones remotas: `pnpm db:migrate:remote`. **No repetir `pnpm db:seed:remote`
sobre esta base ya inicializada**; el seed está diseñado para fallar si ya existe.
Usar migraciones nuevas para cambios posteriores, conservando el historial.

La configuración ficticia de esta base es el seed mínimo de persistencia. Los
50 documentos de R2 y el seed de evaluación `fixtures/seed/company.json` son un
dataset separado con otros IDs; aún no se han importado ni procesado en D1.

Ver [modelo y garantías de D1](../../packages/database/README.md) y
[migraciones de Cloudflare](https://developers.cloudflare.com/d1/reference/migrations/).

## Clave OpenRouter

Para guardar el secreto del Worker desplegado:

```sh
pnpm secret:openrouter
pnpm secrets:list
```

Introducir la clave en el prompt oculto de Wrangler, nunca como argumento ni en
el chat. El listado muestra nombres, no valores. Este comando actualiza y
despliega la versión del Worker.

También se puede añadir desde Cloudflare: Workers & Pages → `oli-api` → Settings
→ Variables and Secrets → Add → Secret, nombre `OPENROUTER_API_KEY` → Deploy.
El backend podrá acceder a ella con `env.OPENROUTER_API_KEY`.

Para desarrollo local, copiar `.dev.vars.example` a `.dev.vars` y completar la
clave allí. `.dev.vars` está ignorado por Git y no se sube automáticamente a
Cloudflare. No usar variables `VITE_*` para esta clave.

Documentación: https://developers.cloudflare.com/workers/configuration/secrets/

## Prueba privada de extracción

`POST /api/internal/extraction-probe`, cuerpo binario PNG/JPEG hasta 5 MiB y
`Content-Type` correspondiente. Requiere `Authorization: Bearer <token>` contra
el secreto separado `EXTRACTION_PROBE_TOKEN`. Sin ese secreto devuelve 404; sin
autorización, 401 antes de leer el archivo o gastar llamadas. Usar solo facturas
ficticias. No compartir el token con el frontend.

La respuesta `data` incluye extracción, hash calculado del cuerpo, modelo,
proveedor, uso/coste reportados, intentos y `verification: NOT_CHECKED`.
No escribe D1, no corrobora la lectura ni decide pagos. No pertenece al contrato
P0 que consume Whady. PDF devuelve 415: falta renderizar y verificar sus páginas.

Crear o rotar el secreto mediante `pnpm exec wrangler secret put EXTRACTION_PROBE_TOKEN`
usando prompt oculto o stdin protegido. `pnpm exec wrangler secret delete EXTRACTION_PROBE_TOKEN`
desactiva la prueba y despliega una versión. Nunca poner tokens en URLs o argumentos.
El archivo local `.env.extraction-probe`, si existe, está ignorado por Git.

Con el token bruto en ese archivo local (permisos 0600), `pnpm test:extraction:live`
envía exclusivamente `001.png`, verifica hash/campos y muestra modelo, latencia,
coste reportado y alertas. **Esta prueba consume OpenRouter**; el coste mostrado
es el de la respuesta final, no necesariamente el de los intentos fallidos.
No se envía al modelo el resultado esperado del dataset.

`pnpm test:extraction:corpus` consume API para los diez PNG sintéticos del manifiesto,
secuencialmente y sin repetir una respuesta incorrecta. Guarda resultados parciales
y finales en `docs/evaluations/`: datos extraídos, diferencias exactas, fallos,
modelos, alertas, tiempos y coste reportado de respuestas exitosas.
Los errores siguen en el informe y producen exit code 1; eso no interrumpe el lote.
Para una regresión explícita separada: `pnpm run test:extraction:corpus --cases=case_001,case_039`.
Se crea un informe nuevo; no reemplaza el resultado original ni demuestra mejora causal
por sí solo. Los valores `null` conservadores se distinguen de importes inventados.

La cadena y sus límites están en [packages/extraction](../../packages/extraction/README.md).

## Entrega para Whady

1. Usar `/api/v1/session`, después `/api/v1/me`. Credenciales por canal privado: el archivo
   **local ignorado** `apps/api/.env.api-demo.json` contiene URL, email y password. No subirlo a
   GitHub ni copiar su contenido a variables públicas del frontend. `DEMO_PASSWORD` vive como
   secreto del Worker; `DEMO_USER_ID` y `DEMO_ORG_ID` se configuran en Wrangler.
2. Todas las mutaciones autenticadas llevan `X-CSRF-Token`; login y mutaciones validan `Origin`.
   La cookie expira en ocho horas y logout la revoca. El login limita diez intentos por IP/15 min.
3. Servir UI y API en el mismo origen. Para desarrollo, proxy de `/api` al Worker o un Worker
   local con bindings locales; conservar `Origin`, host y cookie coherentes. No abrir CORS ni
   guardar tokens OWNER en localStorage. Un proxy debe cambiar el origen al destino y no cachear.
4. Guardar borrador y activar es un comando explícito con revisión/versión e `Idempotency-Key`.
   Subida y revisión también llevan una clave UUID por acción. Los listados respetan el contrato.
5. Subir → `POST /invoices/:id/process` → polling del detalle. Solo `latestDecision` persistido
   determina el resultado. HTTP 200 puede contener BLOCK/ESCALATE o FAILED técnico.
6. Probar [examples/invoices](../../examples/invoices/README.md), que coincide con el seed mínimo.
   El corpus Aurora de 50 documentos tiene otros proveedores y sigue separado: configurar su
   empresa de prueba antes de evaluar, sin copiar etiquetas esperadas al motor.

Un cambio de política invalida solicitudes humanas antiguas. Cambios de proveedor/acuerdo,
reserva o presupuesto se revalidan al decidir; una excepción humana no anula prohibiciones,
duplicados, discrepancias ni saldo insuficiente. El servicio abre el nuevo periodo mensual
con el límite del mandato y la zona empresarial; conserva los periodos y reservas anteriores.

El demo usa un usuario provisionado por Worker; no hay registro público ni selector multiempresa.
Los listados/cálculos recorren los datos de la empresa demo antes de paginar; cambiar a consultas
SQL paginadas antes de operar con un volumen de producción. No hay transferencias ni Polygon.

## Validación y smoke tests

`pnpm test` cubre HTTP, CSRF/roles, D1/R2 locales, idempotencia, motor y concurrencia;
`pnpm test:runtime` empaqueta con Wrangler y ejecuta el Worker real en workerd. Los proveedores
se simulan en ambos; no son métricas OCR. `packages/domain` mantiene sus 50 escenarios aislados.

Para una comprobación viva **con consumo de OpenRouter y escrituras demo**, desde `apps/api`:

```sh
node scripts/smoke-invoice-flow.mjs --run --file ../../examples/invoices/hosting.pdf
node scripts/smoke-invoice-flow.mjs --run --file ../../examples/invoices/accounting.pdf --approve
```

`--approve` simula un OWNER revisando exclusivamente una excepción autorizable. La clave de
subida y revisión se conserva localmente en `.wrangler/demo/` por hash; repetir el script
reutiliza la factura y la decisión, sin nuevas reservas. Los informes quedan en
`docs/evaluations/integration-*.json` y son comprobaciones puntuales, no una métrica del corpus.

Fuentes: [PDF en OpenRouter](https://openrouter.ai/docs/guides/overview/multimodal/pdfs),
[lectura PDF de Cloudflare](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/how-it-works/),
[binding toMarkdown](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/usage/binding/).

## Web y API en el mismo origen

`ASSETS` sirve el build Vite de `apps/web/dist`. El comando `pnpm deploy` construye
primero el frontend (instalar antes sus dependencias con `npm --prefix ../web ci`).
Las rutas `/api/*` ejecutan el Worker antes del fallback SPA, incluyendo errores 401/404.
La web usa cookies privadas y CSRF en memoria; no se abre CORS ni se reescribe Origin.
Para desarrollo: `npm --prefix ../web run dev:live` junto con `pnpm dev`, bindings locales
y el origen explícito `DEV_WEB_ORIGIN` de `.dev.vars`. Ver `apps/web/README.md`.
