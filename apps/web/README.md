# Oli web

Frontend de Whady conectado al API P0 mediante `src/api/http-api.ts`. La frontera HTTP
valida `@oli/contracts`; `view-model.ts` proyecta datos confirmados a los componentes
existentes. No decide autorizaciones, no reconstruye evidencia ni infiere permisos.

## Desarrollo

```sh
npm ci
npm run dev:live
```

En otro terminal, instalar los paquetes enlazados y el API, aplicar las migraciones
locales y ejecutar el seed solo una vez por base nueva. Copiar `apps/api/.dev.vars.example`
a `.dev.vars` y configurar la contraseña demo, OpenRouter y `DEV_WEB_ORIGIN=http://localhost:5173`.
Arrancar `pnpm --dir apps/api dev`. Vite sirve http://localhost:5173 y dirige `/api` al
Worker local en 8787. D1/R2 locales están separados de los datos remotos. Sin clave
OpenRouter local se puede comprobar sesión/configuración, pero procesar devuelve FAILED.

`npm run dev:mock` conserva el modo ilustrativo: sus decisiones no miden el backend real.
El desarrollo normal y el build de producción usan modo live.

## Build y publicación

```sh
npm test
npm run build
```

`apps/api/wrangler.jsonc` sirve `dist` como ASSETS junto al API, en el mismo origen HTTPS.
`pnpm --dir apps/api deploy` construye esta web y publica el Worker; no repite el seed.
Las rutas `/api/*` siempre pasan por el Worker y nunca reciben el fallback HTML de la SPA.

Credenciales por canal privado; ningún password, token, CSRF o clave OpenRouter se
incorpora al bundle ni a localStorage. Login obtiene CSRF en memoria y logout revoca sesión.
Las mutaciones de dinero mantienen su clave UUID ante fallos ambiguos, y envían las
versiones que la persona revisó. No se reemplazan por versiones recién consultadas.

## Comprobaciones

`tests/contract/http-api.test.ts` cubre envelopes, sesiones, permisos, paginación,
respuestas inválidas, claves de reintento, evaluación vacía y un recorrido del cliente
contra el Worker con D1/R2 locales reales. OpenRouter y PDF_TEXT se simulan en ese test;
la prueba no mide OCR. Los recorridos de navegador y proveedores reales se documentan
por separado.

Facturas con correcciones pendientes tienen un estado distinto de las excepciones
que el servidor permite autorizar. El detalle muestra el historial de decisiones; no
fabrica eventos de auditoría que el API no devuelve. Las caídas reintentables reutilizan
la misma factura. El polling se detiene tras 60 segundos y permite actualizar manualmente.
