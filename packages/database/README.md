# Modelo D1 P0

[RETO_BLINKA.md](../../master_files/RETO_BLINKA.md) es la fuente superior:
datos ficticios, decisiones dentro de las reglas, registro explicable y cero pagos reales.
Los DTOs HTTP están en [docs/API.md](../../docs/API.md) y `packages/contracts`.

Este paquete contiene una migración SQL, un seed y pruebas sobre **D1 local con Miniflare/workerd**.
No crea recursos en una cuenta Cloudflare, no despliega un Worker y no implementa aún
el Policy Engine, autenticación, extracción o endpoints.

## Ejecutar las comprobaciones

Desde la raíz del repositorio, Node >=22.18:

```sh
npx --yes pnpm@12.14.0 --dir packages/database install --frozen-lockfile
npx --yes pnpm@12.14.0 --dir packages/database test
```

Cada prueba crea una instancia D1 local nueva, aplica migración/seed con `DB.batch()` y la destruye.
No utiliza mocks SQL ni una base remota. El harness fija la fecha `2026-07-30`, compatible con
el binario de Miniflare instalado; no establece la fecha de compatibilidad del futuro Worker de la app.
`pnpm-workspace.yaml` permite el instalador de esa versión exacta de `workerd`.
Al unificar el workspace con Whady, centralizar lockfile/configuración y conservar esta restricción.

## Tablas y relaciones

| Tabla | Responsabilidad |
|---|---|
| `organizations` | Empresa ficticia, moneda predeterminada y zona horaria |
| `users` | Identidad humana; el seed no habilita credenciales |
| `memberships` | Relación usuario/empresa, rol OWNER o APPROVER |
| `policy_drafts` | Un borrador mutable por empresa con revisión para control de concurrencia |
| `policy_versions` | Contenido inmutable; una única versión ACTIVE por empresa |
| `vendors` | Proveedores permitidos/no permitidos |
| `agreements` | Importe, tolerancia, moneda, frecuencia y concepto por proveedor |
| `budget_periods` | Límite y reserva por empresa, moneda y mes |
| `invoices` | Archivo privado, extracción, proveedor/acuerdo y estado técnico |
| `decisions` | Historial append-only, política, actor, motivos, explicación y evidencia |
| `approval_requests` | Revisión humana vinculada a una escalación autorizable |
| `budget_reservations` | Reserva inmutable vinculada a una decisión APPROVE |
| `audit_events` | Historial append-only de operaciones administrativas |
| `idempotency_keys` | Estado/respuesta por empresa, actor, ruta y clave HTTP |

Las claves foráneas compuestas incluyen `org_id`: una factura no puede apuntar a un proveedor,
acuerdo, política o presupuesto de otra empresa. También impiden vincular un acuerdo al proveedor
equivocado. Esto complementa la autorización HTTP; **no sustituye** filtrar lecturas por la empresa autenticada.

SQL usa snake_case; repositorios futuros convertirán a camelCase y booleans del contrato.
No existe una cuarta decisión financiera: procesamiento, decisión y aprobación humana son estados separados.
`availableMinor` se calcula como `limit_minor - reserved_minor`, no se guarda ni lo edita el cliente.
Para P1 se añadirá una migración de propuestas; no hay tablas de agentes, clearance ni transferencias.

## Decisión y presupuesto atómicos

El servicio futuro primero evalúa con el motor y después intenta insertar la decisión.
Para `APPROVE` debe enviar el `budget_period_id` y una política todavía activa.

Un trigger de esa misma sentencia inserta la reserva desde los hechos actuales de la factura.
Otro incrementa el presupuesto de forma condicional, solo si queda disponible suficiente.
Si falta presupuesto, existe una reserva/obligación duplicada, cambia la política o falla una
restricción, **se revierte también la decisión y el cambio de estado de la factura**.

No insertar reservas desde JS ni hacer `SELECT saldo → UPDATE saldo` en solicitudes separadas.
No duplicar en el repositorio la inserción de reserva que ya hace el trigger.
Operaciones adicionales de un mismo comando (aprobación humana, auditoría, respuesta de
idempotencia) deben agruparse con `DB.batch()` y comprobar sus precondiciones en la escritura.
La tabla de claves prepara la persistencia; el protocolo de reintentos HTTP todavía requiere implementación.

Una segunda petición de aprobar la misma factura falla sin otra reserva. El repositorio debe
consultar/devolver el resultado existente para un reintento legítimo y traducir conflictos al contrato HTTP.
`BLOCK`/`ESCALATE` se registran sin reservar. Los importes son enteros seguros, no floats.

Las cargas duplicadas **sí se conservan en `invoices`** para poder explicar sus bloqueos.
Por eso los índices de hash/número de esa tabla no son únicos; la unicidad se exige en las
reservas, donde evita la doble autorización. Esto concreta la regla del brief sin perder auditoría.
Se protege hash, número por proveedor y obligación mensual/acuerdo de una sola vez.
En P0 las reservas aprobadas no se liberan: no existe cancelación de autorizaciones ni pagos ejecutados.

Estos guards protegen integridad, presupuesto y duplicados; **no constituyen todo el motor de reglas**.
Falta implementar y probar acuerdos, límites, permisos y revalidación completa antes de exponer escritura de decisiones.
Las pruebas de almacenamiento insertan decisiones de fixture, no resultados medidos del agente.

## Seed ficticio

`seed/demo.sql` crea:

- Empresa `org_demo`, moneda USD y zona `America/Caracas`.
- OWNER y APPROVER ficticios con correos `.invalid`, sin password ni `auth_subject` habilitado.
- Mandato v1: automático USD 300, techo USD 1000 y presupuesto mensual USD 2000.
- Acuerdo contable mensual USD 450 y hosting mensual USD 200; un proveedor no permitido.
- Presupuesto del mes actual según UTC-4 y un evento que identifica el seed como sintético.

El seed no añade facturas con archivos inexistentes en R2 ni fabrica historial aprobado.
Los tests crean sus propios metadatos de documentos ficticios exclusivamente dentro de sus instancias.
Es un seed mínimo de persistencia: los datasets de evaluación con otros IDs/proveedores deben
cargarse por separado en una organización/base de prueba aislada, conservando su propio contexto.
Ejecutar el seed una sola vez en una BD demo nueva; repetirlo debe fallar, sin ocultar divergencias con `OR IGNORE`.
El presupuesto del siguiente mes lo creará el servicio según mandato y zona horaria.

## Conectar con el scaffold de Whady

Las migraciones viven aquí mientras no exista el scaffold. En la configuración D1 de la futura
app `apps/web`, usar `migrations_dir: "../../packages/database/migrations"` y el binding `DB`.
No duplicar el SQL en otra carpeta. El `database_id` debe provenir del recurso creado realmente.

Cuando exista la configuración y Wrangler local de la app, aplicar con sus scripts primero en
local. La publicación/migración remota se hará con la cuenta, recurso y entorno identificados;
este paquete no contiene IDs ficticios de recursos desplegables ni ejecuta operaciones remotas.

Las versiones publicadas no se editan: activar v2 requiere un batch que superseda v1 y crea v2,
manteniendo `policy_json` anterior. Antes de activación, validar el JSON con los contratos compartidos,
rol OWNER, revisión del borrador y presupuesto existente. SQL guarda JSON válido; no valida por sí
solo todo el contenido financiero de ese JSON.

## Referencias usadas

- [SQL de D1](https://developers.cloudflare.com/d1/sql-api/sql-statements/)
- [Claves foráneas](https://developers.cloudflare.com/d1/sql-api/foreign-keys/)
- [Batch transaccional](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [Pruebas de D1 con Miniflare](https://developers.cloudflare.com/workers/testing/miniflare/storage/d1/)
- [Migraciones D1](https://developers.cloudflare.com/d1/reference/migrations/)
