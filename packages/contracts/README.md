# @oli/contracts

Tipos TypeScript y validaciones Zod del contrato P0 en [docs/API.md](../../docs/API.md).
Se subordinan siempre a [RETO_BLINKA.md](../../master_files/RETO_BLINKA.md).

Los tipos se infieren de los esquemas: frontend y backend importan la misma definición.
El paquete no contiene decisiones financieras, autenticación, endpoints ni acceso a D1.
Validar forma no otorga autoridad: el backend todavía debe verificar sesión, roles,
política vigente, duplicados, acuerdo y presupuesto antes de persistir una aprobación.

## Comprobar el paquete

Node >=22.18. Desde la raíz del repo, sin instalación global de pnpm:

```sh
npx --yes pnpm@12.14.0 --dir packages/contracts install --frozen-lockfile
npx --yes pnpm@12.14.0 --dir packages/contracts typecheck
npx --yes pnpm@12.14.0 --dir packages/contracts test
```

El lockfile es local al paquete mientras Whady prepara el workspace de la aplicación.
Al integrarlo al workspace pnpm, conservar las versiones y centralizar el lockfile.
El paquete exporta TypeScript fuente para que Vite y el build del Worker lo compilen.

## Usarlo en frontend y backend

En el workspace definitivo, declarar `"@oli/contracts": "workspace:*"` como dependencia
de la app. No crear otro paquete de contratos dentro del frontend.

```ts
import { InvoiceSchema, SaveMandateDraftSchema } from '@oli/contracts';
import type { Invoice, PolicyDecision } from '@oli/contracts';

// Tras comprobar HTTP response.ok:
const invoice = InvoiceSchema.parse(body.data);

// En el límite HTTP del backend, antes de ejecutar la acción:
const input = SaveMandateDraftSchema.parse(requestBody);
```

Whady puede importar solo tipos para mocks; no necesita ejecutar validadores en cada render.
Los esquemas de consulta reciben strings de HTTP y aplican valores predeterminados.
Los esquemas de mutación rechazan campos desconocidos, sin convertir strings en dinero.

`SaveMandateDraftSchema` rechaza programación/delegaciones en P0 hasta implementar P1.
`UploadFileMetadataSchema` solo valida metadatos: falta verificar bytes/MIME real en servidor.
`ExtractedInvoiceSchema` admite campos `null`; los errores deben terminar sin autoaprobación.
Los datos inválidos del modelo deben convertirse en revisión/corrección segura, nunca en un éxito por defecto.

`checkExtraction()` compara los cuatro campos críticos contra una lectura separada del mismo archivo.
Devuelve `CROSS_CHECKED` o `REVIEW_REQUIRED`, nunca aprobación. Solo debe invocarse con metadatos
y corroboración obtenidos por adapters del backend; no autentica la procedencia por sí mismo.
Las citas/confianza del modelo no sustituyen corroboración. Todavía falta implementar los adapters
y conectar el resultado al motor; véase [el plan de extracción](../../docs/EXTRACTION_SAFETY.md).

Las pruebas validan los JSON publicados en `docs/API.md` y casos límite de los contratos.
No son la suite del motor de políticas ni prueban concurrencia, extracción real o seguridad de endpoints.
