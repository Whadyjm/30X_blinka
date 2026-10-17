# Oli API

Worker inicial del backend en la cuenta Cloudflare de Tiamat
(`fbaa64f96579f93b2db32a1eb12ff6c9`). Implementa `GET /api/health`, que consulta
D1 antes de devolver éxito (503 si D1 falla), y una prueba privada de extracción
visual con OpenRouter. El pipeline público de facturas y decisiones aún falta.

Primero instalar los paquetes enlazados desde la raíz del repo:

```sh
pnpm --dir packages/contracts install --frozen-lockfile
pnpm --dir packages/extraction install --frozen-lockfile
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
Contiene 14 tablas de aplicación, empresa ficticia, dos usuarios sin credenciales,
tres proveedores, dos acuerdos, mandato v1 y presupuesto de USD 2000 del periodo
`2026-10`, sin reservas. No contiene facturas ni decisiones inventadas.

Las migraciones se mantienen en `../../packages/database/migrations`, sin copiarlas.
Desarrollo local usa una base independiente; no activa acceso remoto a D1 por defecto.

```sh
pnpm db:migrate:local
pnpm db:seed:local
pnpm test
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
