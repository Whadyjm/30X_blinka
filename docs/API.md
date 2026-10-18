# Contrato API v1 — Oscar ↔ Whady

Estado: **endpoints P0 implementados en `apps/api`; contratos y motor en `packages/contracts` y `packages/domain`**.
El cliente de `apps/web` consume estas rutas y valida los esquemas compartidos;
ver [integración y operación del frontend](../apps/web/README.md).
La extensión conversacional tiene contratos en `packages/contracts` y rutas en el Worker;
ver [tarea y contrato de conversación para Whady](CONVERSATION_FRONTEND_HANDOFF.md).

El [motor puro](../packages/domain/README.md) ya evalúa las reglas del onboarding;
ver [datos y activación](ONBOARDING_POLICY.md). Su resultado es un candidato interno:
solo la decisión confirmada junto con la reserva atómica de D1 se expone como aprobación.
El Worker construye el contexto desde la empresa de la sesión y confirma decisión, reserva,
auditoría y revisión en un batch D1 con control de concurrencia.

Oscar implementa backend, persistencia y reglas. Whady implementa todo el frontend.
Este documento permite que ambos trabajen con los mismos payloads desde ahora.
Oscar define y mantiene el contrato; Whady consume estas rutas y formas sin cambiarlas
por su cuenta. Si una pantalla requiere un dato o una acción adicional, Whady lo comunica
a Oscar, quien actualiza el contrato y coordina el cambio. La implementación del frontend
no necesita esperar una aprobación conjunta del documento.

## 1. Fuente de verdad y alcance

1. [RETO_BLINKA.md](../master_files/RETO_BLINKA.md) prevalece siempre.
2. [Brief v3](../master_files/OLI_MASTER_BRIEF_v3_EMPLEADO_FINANCIERO.md) define la propuesta de producto subordinada al reto.
3. Este contrato concreta el intercambio HTTP. Oscar lo actualiza y comunica los cambios antes de que se cambien las implementaciones afectadas.

El núcleo P0 es: reglas configurables → cargar factura ficticia → extraer proveedor,
importe, moneda y vencimiento → decidir → registrar y explicar → revisión humana cuando corresponde.
`APPROVE` significa aprobado para **pago simulado**. No se mueve dinero.

Delegation Insights es P1. Hermes queda fuera del MVP. Oscar autorizó la extensión
conversacional con herramientas acotadas y confirmación de cambios; la orquestación vive
en el Worker. Oscar también autorizó **Oli Skill**, una integración acotada para que
agentes externos envíen facturas y consulten sus propias decisiones. El resto de Agent Access,
Clearance, registro público y pagos reales no forman parte de este contrato MVP.
Se comienza con una empresa ficticia y una cuenta demo.
No se requiere una pantalla de registro.

## 2. Convenciones comunes

- Base: `/api/v1`. Excepción pública: `GET /api/health`.
- Mismo origen para SPA y API; el frontend usa rutas relativas.
- JSON en camelCase. IDs opacos `string`; el frontend no interpreta su contenido.
- JSON de éxito: `{ "data": ... }`. Listados: `{ "data": [...], "pagination": ... }`.
- Fechas de factura: `YYYY-MM-DD`; timestamps: ISO 8601 UTC, por ejemplo `2026-10-17T02:00:00Z`.
- Importes: enteros seguros en unidades menores. `45000 USD` representa USD 450,00.
  El formateo usa el exponente de cada moneda; no dividir siempre por 100.
- Monedas ISO 4217 en mayúsculas. No se convierten monedas ni se suman presupuestos de monedas diferentes.
- P0 configura un presupuesto mensual en la moneda del mandato. Una factura en otra moneda
  se extrae, pero sin presupuesto compatible no se aprueba. No mostrar un selector que sugiera conversión automática.
- La activación inicializa el presupuesto. Si no existe un presupuesto inicial, procesar no inventa uno: bloquea con `MISSING_BUDGET`. Solo se abre un mes nuevo automáticamente cuando hay un periodo anterior de esa misma moneda; conserva las reservas históricas.
- `null` significa dato desconocido/no disponible. No sustituir por cero o cadena vacía.
- `orgId`, roles, versiones, reservas y decisiones se determinan en el servidor; no se aceptan como autoridad del navegador.
- Los ejemplos y sus resultados son **datos ficticios para mocks**, no métricas de una implementación real.
- Listados: `page=1`, `pageSize=20` por defecto; máximo 100. Orden: `createdAt DESC, id DESC`.
- Toda mutación rechaza campos desconocidos; no aceptar `approved: true` ni decisiones arbitrarias al subir una factura.

### Tres conceptos separados

| Concepto | Valores | Uso en UI |
|---|---|---|
| `Invoice.status` | `RECEIVED`, `PARSING`, `READY`, `PROCESSING`, `DECIDED`, `FAILED` | Progreso técnico |
| `PolicyDecision.action` | `APPROVE`, `BLOCK`, `ESCALATE` | Resultado del motor |
| `ApprovalRequest.state` | `PENDING`, `APPROVED`, `REJECTED`, `INVALIDATED` | Revisión humana |

`DECIDED` no significa aprobado. `ESCALATE` no siempre tiene una aprobación autorizable:
datos ilegibles pueden requerir corregir/subir el documento, no pulsar «Aprobar».
No enviar `NEEDS_APPROVAL` como estado de procesamiento.

### Nombres canónicos

Usamos `action`, `humanExplanation`, `policyVersionId` y `basedOnPolicyVersionId`,
según los tipos del brief. Sus ejemplos con `decision`, `explanation`, `policyVersion`
y `basedOnPolicyVersion` son ilustrativos y **no son el formato HTTP definido aquí**.
El número visible de una política se expone además como `policyVersion` dentro de una decisión.

## 3. Sesión demo y permisos

Contrato de sesión mínimo, independiente del proveedor de autenticación que implemente Oscar:

| Método | Ruta | Entrada | Respuesta |
|---|---|---|---|
| POST | `/session` | `{ email, password }` | `200 { data: Session }` + cookie de sesión |
| GET | `/me` | Sin body | `200 { data: Session }` |
| DELETE | `/session` | Sin body | `204`, elimina sesión |

El campo `email` acepta el correo o el alias demo configurado en el backend
mediante `DEMO_USERNAME`. El alias no concede permisos por sí solo: sigue exigiendo
la contraseña demo y resuelve únicamente el usuario/empresa provisionados.
`Session.user.email` conserva el correo real del registro.

```ts
type Role = 'OWNER' | 'APPROVER';
type Session = {
  user: { id: string; name: string; email: string };
  organization: { id: string; name: string; defaultCurrency: string; timezone: string };
  role: Role;
  csrfToken: string;
};
```

Cookie `HttpOnly`, `Secure` en producción y `SameSite`. Credenciales de demo comunicadas
por separado, sin claves reales en este documento ni credenciales incorporadas al bundle.
`GET /me` devuelve `401` si no hay sesión; el front muestra acceso demo.

Las mutaciones autenticadas llevan `X-CSRF-Token` obtenido de `/me` o del login.
El login valida origen y tiene limitación de intentos. No se envían tokens de dueño en localStorage.

OWNER administra reglas, proveedores y acuerdos. OWNER y APPROVER pueden revisar excepciones
autorizables; ambos pueden consultar y cargar facturas en su empresa. Un APPROVER no cambia reglas.
Otros permisos se incorporarán explícitamente si fueran necesarios.

## 4. Modelos que consume el frontend

Estos son DTOs HTTP, no filas SQL. Las validaciones y tipos compartidos P0 están en
[`packages/contracts`](../packages/contracts/README.md); Whady debe importar sus tipos
para los mocks. Los bloques de este documento sirven de referencia; los tipos de código
se infieren de los esquemas compartidos, sin mantener una segunda definición divergente.

```ts
type DecisionAction = 'APPROVE' | 'BLOCK' | 'ESCALATE';
type InvoiceStatus = 'RECEIVED' | 'PARSING' | 'READY' | 'PROCESSING' | 'DECIDED' | 'FAILED';
type Pagination = { page: number; pageSize: number; total: number };
type Page<T> = { data: T[]; pagination: Pagination };
type Envelope<T> = { data: T };

type Vendor = {
  id: string;
  name: string;
  allowed: boolean;
  externalRef: string | null;
  createdAt: string;
};
type Agreement = {
  id: string;
  vendorId: string;
  currency: string;
  amountMinor: number;
  toleranceMinor: number;
  frequency: 'ONE_TIME' | 'MONTHLY';
  concept: string;
  active: boolean;
  createdAt: string;
};
type ScopedDelegation = {
  vendorId: string;
  agreementId: string;
  currency: string;
  maxAmountMinor: number;
  validFrom: string;
  validUntil: string;
  maxPerPeriod: number;
};
type MandateRules = {
  currency: string;
  automaticLimitMinor: number;
  hardLimitMinor: number;
  monthlyBudgetMinor: number;
  requireAllowedVendor: boolean;
  requireAgreement: boolean;
  humanApprovalEnabled: boolean;
  reviewAboveMinor: number;
  processDaysBeforeDue: number;
  scopedDelegations: ScopedDelegation[];
};
type PolicyVersion = {
  id: string;
  version: number;
  status: 'ACTIVE' | 'SUPERSEDED';
  rules: MandateRules;
  activatedAt: string;
  activatedBy: string;
};
type MandateDraft = {
  id: string;
  revision: number;
  basedOnPolicyVersionId: string | null;
  rules: MandateRules;
  updatedAt: string;
};
type BudgetPeriod = {
  id: string;
  currency: string;
  periodKey: string; // YYYY-MM, según timezone de la empresa
  limitMinor: number;
  reservedMinor: number;
  availableMinor: number;
};
type ExtractedInvoice = {
  vendorName: string | null;
  invoiceNumber: string | null;
  amountMinor: number | null;
  currency: string | null;
  issuedAt: string | null;
  dueDate: string | null;
  servicePeriod: string | null; // YYYY-MM, solo si el documento identifica el periodo mensual
  description: string | null;
  extractionWarnings: string[];
  evidence: Array<{ field: string; source: string; quote?: string }>;
};
type DecisionReasonCode =
  | 'ALLOWED_VENDOR' | 'UNKNOWN_VENDOR'
  | 'DUPLICATE_INVOICE' | 'POSSIBLE_DUPLICATE'
  | 'AGREEMENT_MISMATCH' | 'MISSING_AGREEMENT'
  | 'AMOUNT_ABOVE_AUTO_LIMIT' | 'AMOUNT_ABOVE_HARD_LIMIT'
  | 'BUDGET_EXCEEDED' | 'MISSING_BUDGET'
  | 'INVALID_OR_MISSING_DATA' | 'INVALID_CURRENCY'
  | 'HUMAN_APPROVAL_REQUIRED' | 'POLICY_ALLOWED'
  | 'HUMAN_APPROVED' | 'HUMAN_REJECTED';
type PolicyDecision = {
  id: string;
  invoiceId: string;
  action: DecisionAction;
  reasons: DecisionReasonCode[];
  humanExplanation: string;
  policyVersionId: string;
  policyVersion: number;
  checkedAt: string;
  needsHumanApproval: boolean;
  actor: { kind: 'SYSTEM' | 'HUMAN'; userId: string | null };
  facts: {
    amountMinor: number | null;
    currency: string | null;
    automaticLimitMinor: number;
    hardLimitMinor: number;
    budgetAvailableBeforeMinor: number | null;
    vendorAllowed: boolean | null;
    agreementId: string | null;
  };
  trace: Array<{
    rule: string;
    outcome: 'PASS' | 'BLOCK' | 'ESCALATE';
    explanation: string;
    evidence: Record<string, string | number | boolean | null>;
  }>;
  simulated: true;
};
type ApprovalRequest = {
  id: string;
  invoiceId: string;
  decisionId: string;
  policyVersionId: string;
  state: 'PENDING' | 'APPROVED' | 'REJECTED' | 'INVALIDATED';
  reason: string;
  canApprove: boolean; // calculado para la sesión actual; servidor revalida
  reviewerId: string | null;
  reviewComment: string | null;
  createdAt: string;
  decidedAt: string | null;
};
type Invoice = {
  id: string;
  status: InvoiceStatus;
  source: 'HUMAN_UPLOAD' | 'TELEGRAM' | 'EMAIL';
  file: { name: string; mimeType: string; sizeBytes: number; url: string };
  vendorId: string | null;
  vendorName: string | null;
  agreementId: string | null;
  invoiceNumber: string | null;
  amountMinor: number | null;
  currency: string | null;
  issuedAt: string | null;
  dueDate: string | null;
  servicePeriod: string | null;
  description: string | null;
  extractionWarnings: string[];
  latestDecision: PolicyDecision | null;
  approvalRequest: ApprovalRequest | null;
  processingError: { code: string; message: string; retryable: boolean } | null;
  createdAt: string;
  updatedAt: string;
};
type InvoiceDetail = Invoice & {
  extraction: ExtractedInvoice | null;
  decisions: PolicyDecision[]; // historial cronológico, sin reescribir decisiones anteriores
};
```

El frontend recibe el importe extraído incluso si es ambiguo; solo usa `latestDecision`
para mostrar el resultado oficial. No calcula «aprobado» comparando el importe con un límite.
Solo `APPROVE` persistido después de reservar presupuesto permite mostrar aprobación simulada.
La extracción requiere corroboración de campos críticos según
[`EXTRACTION_SAFETY.md`](./EXTRACTION_SAFETY.md). Una discrepancia se muestra con
`extractionWarnings` y la explicación/traza; no crea por sí misma una excepción humana autorizable.
No hay campos HTTP nuevos obligatorios. `CROSS_CHECKED` es un resultado interno de comparación,
no una decisión financiera ni una garantía de lectura correcta.

## 5. Mapa P0 y comportamiento de endpoints

`Session` y errores se describen arriba/abajo. Todas las rutas siguientes requieren sesión,
excepto health. Se devuelve `404` tanto para recurso inexistente como para recurso ajeno.

| Método | Ruta | Entrada | Respuesta de éxito |
|---|---|---|---|
| GET | `/api/health` | — | `200 { ok: true, service: "oli-api" }` |
| GET | `/mandate` | — | `200 Envelope<{ active: PolicyVersion \| null; draft: MandateDraft \| null }>` |
| PUT | `/mandate/draft` | Ver abajo | `200 Envelope<MandateDraft>` |
| POST | `/mandate/activate` | Ver abajo | `200 Envelope<PolicyVersion>` |
| GET | `/vendors` | Paginación | `200 Page<Vendor>` |
| POST | `/vendors` | `{ name, allowed, externalRef }` | `201 Envelope<Vendor>` |
| PATCH | `/vendors/:id` | Uno o más campos de creación | `200 Envelope<Vendor>` |
| GET | `/agreements` | Paginación; `vendorId?` | `200 Page<Agreement>` |
| POST | `/agreements` | Campos de Agreement excepto `id`, `createdAt` | `201 Envelope<Agreement>` |
| PATCH | `/agreements/:id` | Uno o más campos de creación | `200 Envelope<Agreement>` |
| GET | `/budgets` | `periodKey?` (`YYYY-MM`; defecto mes actual) | `200 Envelope<BudgetPeriod[]>` |
| POST | `/invoices` | Multipart, campo `file` | `201 Envelope<Invoice>` |
| GET | `/invoices` | Filtros abajo | `200 Page<Invoice>` |
| GET | `/invoices/:id` | — | `200 Envelope<InvoiceDetail>` |
| GET | `/invoices/:id/file` | — | `200` binario privado PDF/imagen |
| POST | `/invoices/:id/process` | Sin body | `200 Envelope<InvoiceDetail>` o `202 Envelope<Invoice>` |
| GET | `/approvals` | Paginación; `state?` (defecto `PENDING`) | `200 Page<{ approval: ApprovalRequest; invoice: Invoice }>` |
| POST | `/approvals/:id/decision` | Ver abajo | `200 Envelope<{ approval: ApprovalRequest; invoice: InvoiceDetail }>` |
| GET | `/dashboard` | — | `200 Envelope<Dashboard>` |
| GET | `/evaluation/summary` | — | `200 Envelope<EvaluationSummary \| null>` |
| GET | `/evaluation/report` | — | `200 Envelope<PublishedEvaluationReport>` |

`PATCH` de proveedores/acuerdos, `/session`, `/budgets`, `/dashboard` y `/invoices/:id/file`
completan operaciones que las pantallas necesitan y el mapa del brief no detallaba.
`POST /orgs` se pospone: la empresa demo se crea mediante seed, sin onboarding multiempresa.

### Reglas y presupuesto

Crear/actualizar borrador requiere OWNER:

```ts
type SaveMandateDraft = {
  expectedRevision: number | null; // null solo si no existe borrador
  basedOnPolicyVersionId: string | null; // null solo para primer mandato
  rules: MandateRules;
};
type ActivateMandate = {
  draftId: string;
  expectedRevision: number;
  expectedActivePolicyVersionId: string | null;
  confirmed: true;
};
```

Guardar borrador no activa nada. Activar revalida el contenido, la revisión y la política de origen;
si cambiaron, `409 POLICY_CHANGED` o `409 DRAFT_CHANGED` y el front recarga y pide nueva confirmación.
El backend asigna ID y número de versión. No se editan versiones activadas.

Condiciones: `0 <= reviewAboveMinor <= automaticLimitMinor <= hardLimitMinor`,
`monthlyBudgetMinor >= 0`, importes seguros; moneda válida y compatible con el presupuesto.
Un importe **mayor** al límite automático o a `reviewAboveMinor` requiere revisión humana;
la igualdad al umbral no lo supera. Si no se permite revisión humana se bloquea ese caso.
El límite duro, las prohibiciones, duplicados y presupuesto siguen prevaleciendo.

Ejemplo completo del primer borrador:

```json
{
  "expectedRevision": null,
  "basedOnPolicyVersionId": null,
  "rules": {
    "currency": "USD",
    "automaticLimitMinor": 30000,
    "hardLimitMinor": 100000,
    "monthlyBudgetMinor": 200000,
    "requireAllowedVendor": true,
    "requireAgreement": true,
    "humanApprovalEnabled": true,
    "reviewAboveMinor": 30000,
    "processDaysBeforeDue": 0,
    "scopedDelegations": []
  }
}
```

La demo empieza con `requireAllowedVendor=true`, `requireAgreement=true`,
`humanApprovalEnabled=true`, `reviewAboveMinor=automaticLimitMinor` y `scopedDelegations=[]`.
Desactivar un requisito solo se hace mediante activación explícita del OWNER; no por chat.
`processDaysBeforeDue=0` en P0: se evalúa al procesar, sin scheduler. No mostrar controles de
programación hasta implementar P1. Fechas futuras/vencidas se muestran; no se simulan pagos futuros.
El esquema de entrada P0 rechaza `processDaysBeforeDue` distinto de cero y delegaciones no vacías
hasta que se implementen esas funciones; no acepta configuraciones que el sistema todavía no aplica.

El presupuesto se modifica activando mandato, no escribiendo reservas desde el navegador.
Actualizar el límite del mes conserva las reservas existentes; no puede quedar por debajo
de `reservedMinor`. La moneda del mandato no puede cambiar con reservas vigentes
(`409 CURRENCY_CHANGE_CONFLICT`). El servidor conserva las reglas/versiones que dieron origen a cada decisión.

Modificar proveedor/acuerdo requiere OWNER y un evento auditado con antes/después.
No cambia resultados históricos; el siguiente procesamiento o aprobación usa datos vigentes.
`frequency=MONTHLY` exige identificar el periodo de servicio desde la evidencia del documento;
se guarda en `servicePeriod`. Si no se puede comprobar, se escala. No inferirlo solo de
la fecha de vencimiento. P0 permite un cobro por acuerdo y periodo mensual; otro cobro para
ese mismo periodo se bloquea si se confirma la duplicación, o se escala si es ambiguo.
`ONE_TIME` permite una sola obligación por acuerdo. Reintentos de procesamiento no crean otra obligación.
`amountMinor > 0`, `toleranceMinor >= 0`; nombres/conceptos no vacíos tras trim.
Referencias a proveedor/acuerdo deben pertenecer a la empresa de la sesión.

### Facturas: subida, procesamiento y polling

1. `POST /invoices`: `FormData` con un PDF/PNG/JPEG ficticio, máximo **5 MiB (5 242 880 bytes)**.
   No fijar `Content-Type` manualmente; el navegador incluye el boundary.
2. Devuelve factura `RECEIVED`, campos desconocidos en `null` y `latestDecision=null`.
3. El servidor guarda un trabajo durable junto con la factura y lo publica en la cola. El front puede llamar `POST /invoices/:id/process` para consultar/solicitar el mismo trabajo.
4. En producción devuelve `202` con el detalle actual; una factura ya terminada devuelve `200`. El procesamiento continúa aunque se cierre la página. Sin binding de cola, el entorno local conserva ejecución síncrona para desarrollo.
5. Mientras esté `RECEIVED`, `PARSING`, `READY` o `PROCESSING`, consultar `GET /invoices/:id`
   cada 2 segundos. Parar en `DECIDED`/`FAILED`, al salir de la pantalla o después de
   60 segundos; al agotar ese tiempo mostrar «Sigue procesando» con actualización manual,
   sin inventar un fallo o repetir automáticamente la subida.

Repetir `process` devuelve el trabajo/resultado existente y nunca reserva dos veces.
Los fallos técnicos transitorios vuelven a `RECEIVED` con `processingError.retryable=true` mientras esperan el siguiente intento automático. Hay como máximo tres intentos por factura, con espera de 30/120 segundos; repetir el endpoint no reinicia ese límite. Al agotarlo o ante un error permanente, queda `FAILED` con `retryable=false`.
Una factura ya decidida no se reevalúa por llamar `process`; el endpoint explícito `/reevaluate` descrito abajo vuelve a comprobar las reglas.

Un documento ilegible puede terminar `DECIDED` con `ESCALATE` y explicación de datos faltantes.
Una caída técnica nunca crea una aprobación nueva: el trabajo se recupera o termina `FAILED`. Ante fallo de polling,
mantener la última información conocida y mostrar el error de conexión.

Subir el mismo documento como factura nueva debe producir un registro auditable bloqueado como
duplicado cuando se confirme. Repetir la misma solicitud HTTP con la misma clave de idempotencia
devuelve el mismo registro original; son dos situaciones distintas.

### Tipo de documento y documentos que no son factura

El lector clasifica el original como `INVOICE`, `PAYMENT_RECEIPT`, `DELIVERY_NOTE`, `QUOTE`,
`CREDIT_NOTE`, `OTHER` o `UNKNOWN`. El tipo se guarda como metadata de la lectura del servidor,
no como una entrada editable por el navegador ni como un permiso para aprobar.

- Un documento identificado como comprobante, nota de entrega, cotización, nota de crédito u
  otro tipo ajeno a una factura produce `BLOCK / NOT_AN_INVOICE`, sin solicitud humana ni reserva.
- Un tipo `UNKNOWN` produce `ESCALATE / DOCUMENT_TYPE_UNCERTAIN`. Que falten datos, por sí solo, no
  prueba que el documento no sea una factura. Una factura ilegible sigue en revisión.
- `INVOICE` no sustituye la corroboración independiente ni las comprobaciones financieras.

La traza registra `DOCUMENT_TYPE` y su explicación antes del control de extracción. No ejecutar
las reglas de proveedor/acuerdo/presupuesto sobre un documento que no se identificó como factura.
El hash duplicado puede bloquear independientemente del tipo. El texto del archivo no concede
instrucciones ni autoridad para aprobar o cambiar su clasificación.

El reanálisis explícito admite una compatibilidad negativa acotada para lecturas históricas sin
campo de tipo: una advertencia categórica exacta conocida de comprobante de pago móvil, cuatro
campos críticos desconocidos, hash/identidad de lectura del servidor y modelo permitido. Solo
puede agregar un bloqueo, nunca acreditar una factura ni habilitar aprobación. La nueva evidencia
registra `LEGACY_NEGATIVE_WARNING`; no se modifica la extracción ni la decisión histórica ni se
pretende haber ejecutado OCR nuevo.

### Reanalizar con las reglas actuales

`POST /invoices/:id/reevaluate` requiere OWNER, sesión/CSRF, `Idempotency-Key` y body
`{ expectedDecisionId, expectedPolicyVersionId }` (ambos obligatorios). Devuelve
`200 Envelope<InvoiceDetail>`. Reutiliza la lectura guardada y ejecuta el motor con el
proveedor, acuerdo, política y presupuesto actuales; no invoca OCR ni al modelo.
Agrega una decisión y un evento `INVOICE_REEVALUATED`; mantiene el documento, la extracción
y todas las decisiones anteriores. Invalida cualquier solicitud humana pendiente anterior
y crea una nueva solo si el resultado actual la permite. Una nueva aprobación reserva
atómicamente mediante los triggers originales; el replay devuelve la misma respuesta.

No reabre facturas ya reservadas ni aprobadas/rechazadas por una persona (`409 APPROVAL_NOT_ALLOWED`).
Exige una factura decidida con lectura completa; no reinicia trabajos FAILED ni su límite de intentos.
Lecturas de una versión antigua permanecen en revisión por seguridad. Un cambio de identidad de
proveedor/acuerdo requiere el flujo de alta/confirmación (`409 INVOICE_IDENTITY_CHANGED`),
y cambios concurrentes devuelven `409 DECISION_CHANGED`/`POLICY_CHANGED` para actualizar la pantalla.
El botón del detalle explica que reanaliza reglas y deshabilita los casos protegidos.

El backend permite **tres reanálisis exitosos en total por empresa y SHA-256 del documento**,
con **60 segundos entre ellos**. El primer procesamiento no consume esta cuota; los reintentos
técnicos del trabajo conservan su límite independiente de tres intentos y su backoff.
Se cuenta el historial `INVOICE_REEVALUATED` existente: ni otro usuario, otra sesión, otra clave,
un cambio de política ni subir los mismos bytes con otro nombre reinician la cuota de reanálisis.
Un replay con la misma clave devuelve la respuesta original y no consume otro intento.

- `429 REANALYSIS_COOLDOWN`: incluye `Retry-After` con los segundos que faltan. Whady puede
  deshabilitar temporalmente el botón y mostrar el mensaje del servidor.
- `409 REANALYSIS_LIMIT_REACHED`: se agotó la cuota de este documento; no se debe reintentar
  automáticamente ni presentar una cuenta regresiva. No hay reinicio automático de la cuota.

Las validaciones rechazadas y las transacciones fallidas no consumen cuota ni generan una decisión.
Un trigger D1 aplica ambos límites dentro de la misma transacción: un exceso concurrente revierte
la decisión, las solicitudes humanas, cualquier reserva y los eventos asociados. Esto limita
los reanálisis efectivos; no reemplaza un límite general de tráfico HTTP ni de nuevas cargas.

[Comprobación en producción](evaluations/invoices-reanalysis-limits-production-20261017.json):
un reanálisis de documento sintético devolvió 200, el siguiente inmediato 429 con `Retry-After: 60`
y el replay 200 sin otra decisión ni cambios en presupuesto. El agotamiento de cuota y las
carreras entre copias se verifican contra D1 local, sin agotar la cuota de documentos productivos.

Filtros de `GET /invoices`: `status?`, `action?`, `vendorId?`, `needsHumanApproval?` y paginación.
Los filtros se combinan con AND; `action` consulta la última decisión.
`needsHumanApproval=true` selecciona solicitudes `PENDING` autorizables, no todos los `ESCALATE`.

`Invoice.file.url` es una ruta del mismo origen, por ejemplo `/api/v1/invoices/inv_demo_450/file`.
Permite preview autenticado; no entrega `file_key`, secretos ni URLs públicas de R2.
PDF se sirve con `Content-Type: application/pdf`, imágenes con su MIME validado;
`Content-Disposition: inline` y nombre saneado. Respuestas privadas sin caché compartida.
No hay edición manual de extracción en P0: datos ilegibles requieren una nueva carga corregida.

### Aprobación humana

```json
{
  "action": "APPROVE",
  "comment": "Verifiqué el acuerdo mensual y autorizo esta excepción.",
  "expectedDecisionId": "dec_demo_escalation",
  "expectedPolicyVersionId": "pol_demo_v1"
}
```

`action` admite `APPROVE` o `REJECT`; `comment` es obligatorio, entre 1 y 1000 caracteres tras trim.
Estos son comandos humanos; `REJECT` se registra como nueva decisión `BLOCK` con `HUMAN_REJECTED`.
El OWNER/APPROVER solo autoriza excepciones que la política permite. El servidor revalida
permisos, proveedor, acuerdo, duplicados, política y presupuesto; no basta con `canApprove=true`.

Si los IDs quedaron antiguos: `409 POLICY_CHANGED` o `409 DECISION_CHANGED`.
Si ya no es autorizable: `409 APPROVAL_NOT_ALLOWED`; se invalida la solicitud pendiente,
se registra el motivo actual y el front vuelve a cargar detalle/lista.
Rechazar una solicitud vigente agrega `BLOCK`; aprobar agrega `APPROVE` con actor humano,
solo tras reserva segura. Conservar la escalación anterior en `decisions`.

### Idempotencia y errores de concurrencia

El frontend manda `Idempotency-Key` (UUID aleatorio por acción lógica) en subida,
activación de mandato y decisión humana. Lo reutiliza al reintentar tras un fallo de red;
una nueva acción/documento genera otra clave. `process` es idempotente además por factura.

El backend vincula la clave a empresa, actor, ruta y contenido. Misma clave con contenido distinto:
`409 IDEMPOTENCY_CONFLICT`. Repetición con mismo contenido: devuelve la misma respuesta sin repetir efectos.
Garantía P0: las claves se conservan durante toda la vida de los datos de demo.

El backend evita simultáneamente doble aprobación, doble reserva y superar el presupuesto.
El frontend no anuncia éxito antes de la confirmación del servidor.

## 6. Ejemplos listos para mocks

### Factura recién subida — `201`

```json
{
  "data": {
    "id": "inv_demo_450",
    "status": "RECEIVED",
    "source": "HUMAN_UPLOAD",
    "file": { "name": "acme-octubre.pdf", "mimeType": "application/pdf", "sizeBytes": 18240, "url": "/api/v1/invoices/inv_demo_450/file" },
    "vendorId": null,
    "vendorName": null,
    "agreementId": null,
    "invoiceNumber": null,
    "amountMinor": null,
    "currency": null,
    "issuedAt": null,
    "dueDate": null,
    "servicePeriod": null,
    "description": null,
    "extractionWarnings": [],
    "latestDecision": null,
    "approvalRequest": null,
    "processingError": null,
    "createdAt": "2026-10-17T02:00:00Z",
    "updatedAt": "2026-10-17T02:00:00Z"
  }
}
```

### Decisión que irá dentro de `latestDecision`

Proveedor/acuerdo válidos por USD 450, automático USD 300 y techo USD 1000:

```json
{
  "id": "dec_demo_escalation",
  "invoiceId": "inv_demo_450",
  "action": "ESCALATE",
  "reasons": ["AMOUNT_ABOVE_AUTO_LIMIT", "HUMAN_APPROVAL_REQUIRED"],
  "humanExplanation": "La factura de USD 450 coincide con el acuerdo, pero supera el límite automático de USD 300. Requiere autorización humana.",
  "policyVersionId": "pol_demo_v1",
  "policyVersion": 1,
  "checkedAt": "2026-10-17T02:00:05Z",
  "needsHumanApproval": true,
  "actor": { "kind": "SYSTEM", "userId": null },
  "facts": { "amountMinor": 45000, "currency": "USD", "automaticLimitMinor": 30000, "hardLimitMinor": 100000, "budgetAvailableBeforeMinor": 200000, "vendorAllowed": true, "agreementId": "agr_demo_acme" },
  "trace": [
    { "rule": "AUTO_LIMIT", "outcome": "ESCALATE", "explanation": "45000 supera 30000 unidades menores de USD.", "evidence": { "amountMinor": 45000, "automaticLimitMinor": 30000, "currency": "USD" } }
  ],
  "simulated": true
}
```

En el detalle procesado, actualizar los campos de factura, `status=DECIDED` y usar:

```json
{
  "id": "apr_demo_450",
  "invoiceId": "inv_demo_450",
  "decisionId": "dec_demo_escalation",
  "policyVersionId": "pol_demo_v1",
  "state": "PENDING",
  "reason": "Importe superior al límite automático, dentro del tramo autorizable.",
  "canApprove": true,
  "reviewerId": null,
  "reviewComment": null,
  "createdAt": "2026-10-17T02:00:05Z",
  "decidedAt": null
}
```

Ejemplo de listado vacío, aplicable a facturas, proveedores o aprobaciones:

```json
{ "data": [], "pagination": { "page": 1, "pageSize": 20, "total": 0 } }
```

Mocks mínimos para Whady (no modificar solo el badge: mantener coherentes todos los campos):

| Escenario ficticio | Estado técnico | Decisión | Aprobación |
|---|---|---|---|
| Documento recibido | `RECEIVED` | `null` | `null` |
| Extrayendo | `PARSING` | `null` | `null` |
| Válida USD 200, acuerdo 200 y presupuesto suficiente | `DECIDED` | `APPROVE / POLICY_ALLOWED` | `null` |
| Duplicado confirmado | `DECIDED` | `BLOCK / DUPLICATE_INVOICE` | `null` |
| Proveedor no permitido | `DECIDED` | `BLOCK / UNKNOWN_VENDOR` | `null` |
| USD 450 con acuerdo válido y automático 300 | `DECIDED` | `ESCALATE / HUMAN_APPROVAL_REQUIRED` | `PENDING` |
| USD 200 sin presupuesto suficiente | `DECIDED` | `BLOCK / BUDGET_EXCEEDED` | `null` |
| Acuerdo 400 y factura 475 fuera de tolerancia | `DECIDED` | `ESCALATE / AGREEMENT_MISMATCH` | `null`, requiere corregir/aclarar |
| Monto ilegible | `DECIDED` | `ESCALATE / INVALID_OR_MISSING_DATA` | `null` |
| Proveedor de extracción caído | `RECEIVED` durante reintentos; `FAILED` al agotarlos | `null` | `null`; error técnico seguro |

La política demo escala discrepancias comerciales para aclaración, pero no permite aprobarlas
con un botón genérico. No se trata de una excepción autorizable como superar el automático.
Ante varios motivos, prevalece `BLOCK > ESCALATE > APPROVE`; conservar las razones relevantes.

## 7. Dashboard y evaluación

```ts
type Dashboard = {
  counts: {
    total: number;
    approved: number;
    blocked: number;
    escalated: number;
    needsHumanApproval: number;
    processing: number;
    failed: number;
  };
  budgets: BudgetPeriod[];
  upcoming: Invoice[]; // máximo 5, dueDate >= hoy, orden ascendente
  recentDecisions: PolicyDecision[]; // máximo 10, checkedAt descendente
  generatedAt: string;
  simulated: true;
};
type EvaluationSummary = {
  datasetVersion: string;
  evaluatedAt: string;
  totalCases: number;
  correctDecisions: number;
  unsafeApprovals: number;
  correctAutonomousCases: number;
  explainedDecisions: number;
  decisionAccuracy: number; // 0..1, denominador totalCases
  correctAutonomy: number; // 0..1, denominador totalCases
  explanationCoverage: number; // 0..1, denominador totalCases
};
```

Dashboard se calcula en backend, para toda la empresa y según la última decisión de cada factura;
`needsHumanApproval` es subconjunto de `escalated`, no un estado adicional que sumar al total.
`processing` incluye RECEIVED/PARSING/READY/PROCESSING. `upcoming` excluye facturas bloqueadas/fallidas.
Las reservas no son transferencias ni importes bancarios pagados.

Sin mandato: `/mandate` devuelve `active=null`; el front muestra configuración inicial.
Procesar sin mandato activo devuelve `409 MANDATE_REQUIRED`, sin aprobar.
`/evaluation/summary` publica una medición histórica sobre una empresa ficticia y documentos
etiquetados antes de ejecutar. Los contadores y porcentajes se derivan de sus veinte resultados
observados; los fallos técnicos permanecen en el denominador. `datasetVersion` identifica la
muestra ficticia, el alcance real de los lectores/cola y el prefijo de la versión medida. La
fecha es la del cierre de la corrida, no la hora de esta petición. No describe las facturas de
la empresa que consulta ni garantiza resultados para todos los formatos.

`/evaluation/report` requiere la misma sesión autenticada y devuelve los metadatos de esa
medición: `datasetVersion`, `evaluatedAt`, `workerVersion`, `bundleSha256`, `readerVersion`,
`reportPath`, `reportSha256`, `manifestSha256`, `scope`, `synthetic:true`, `limits`, `cases` y
`summary`. Cada caso conserva acción esperada, acción inicial/final observada, motivos,
corrección, autonomía, explicación y fallo técnico. El control adicional P0 queda fuera del
denominador y se declara con `targetedP0IncludedInDenominator:false`. El detalle no expone
sesiones, claves ni documentos privados de una organización. Una versión posterior puede
servir este reporte histórico sin atribuírselo como una nueva corrida.

## 8. Errores y estados de UI

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Revisa los campos indicados.",
    "fieldErrors": { "rules.hardLimitMinor": ["Debe ser mayor o igual al límite automático."] },
    "requestId": "req_demo_001"
  }
}
```

`fieldErrors` es siempre un objeto (vacío si no aplica). Claves son rutas de campos,
por ejemplo `rules.hardLimitMinor`. `requestId` permite investigar sin exponer secretos.

| HTTP | Códigos | Comportamiento frontend |
|---|---|---|
| 400 | `VALIDATION_ERROR`, `INVALID_QUERY`, `IDEMPOTENCY_KEY_REQUIRED` | Mostrar error y conservar formulario |
| 401 | `UNAUTHENTICATED`, `INVALID_CREDENTIALS` | Pedir sesión; no reintentar mutación automáticamente |
| 403 | `FORBIDDEN`, `CSRF_INVALID` | Informar falta de permiso o pedir renovar sesión |
| 404 | `NOT_FOUND` | Recurso no disponible |
| 409 | `POLICY_CHANGED`, `DRAFT_CHANGED`, `DECISION_CHANGED`, `APPROVAL_NOT_ALLOWED`, `IDEMPOTENCY_CONFLICT`, `MANDATE_REQUIRED`, `BUDGET_LIMIT_CONFLICT`, `CURRENCY_CHANGE_CONFLICT` | Recargar estado; nueva revisión/confirmación humana si corresponde |
| 413 | `FILE_TOO_LARGE` | Mostrar límite de 5 MiB |
| 415 | `UNSUPPORTED_FILE_TYPE` | Pedir PDF/PNG/JPEG |
| 429 | `RATE_LIMITED` | Respetar `Retry-After` en segundos |
| 500/503 | `INTERNAL_ERROR`, `SERVICE_UNAVAILABLE` | Mostrar fallo técnico sin anunciar aprobación |

`BLOCK` y `ESCALATE` son resultados de negocio y responden HTTP `200` al procesar;
no son errores HTTP. Un `409` al aprobar nunca se interpreta como aprobación exitosa.
Validar además el MIME/contenido del archivo en servidor, no solo su extensión.

## 9. P1 reservado: delegaciones

No integrar estas pantallas a datos reales hasta que P0 esté probado. Formas reservadas:

```ts
type DelegationProposal = {
  id: string;
  vendorId: string;
  agreementId: string;
  currency: string;
  proposedAutoLimitMinor: number;
  validFrom: string;
  validUntil: string;
  maxPerPeriod: number;
  evidenceDecisionIds: string[];
  evidence: Array<{ decisionId: string; invoiceId: string }>;
  basedOnPolicyVersionId: string;
  status: 'DRAFT' | 'REJECTED' | 'ACCEPTED' | 'STALE';
  description: string;
  currentRules: MandateRules;
  proposedRules: MandateRules;
  activatedPolicyVersionId: string | null;
  createdAt: string;
};
```

| Método | Ruta | Entrada | Respuesta |
|---|---|---|---|
| GET | `/delegations/proposals` | `status?`, paginación | `200 Page<DelegationProposal>` |
| POST | `/delegations/proposals/detect` | Sin body | `200 Envelope<DelegationProposal[]>` |
| POST | `/delegations/proposals/:id/reject` | `{ comment }` | `200 Envelope<DelegationProposal>` |
| POST | `/delegations/proposals/:id/activate` | `{ expectedActivePolicyVersionId, confirmed: true }` | `200 Envelope<{ proposal: DelegationProposal; policy: PolicyVersion }>` |


Mutaciones de propuestas requieren OWNER. Activación y reevaluación llevan `Idempotency-Key`;
la detección no duplica propuestas equivalentes. Sin evidencia suficiente devuelve `data=[]`.
La propuesta incluye los dos conjuntos de reglas para que el front muestre antes/después;
el servidor reconstruye y valida el cambio, no acepta reglas arbitrarias del navegador.
`evidence` vincula cada `decisionId` con su `invoiceId` para enlazar al detalle de factura;
sus IDs coinciden con `evidenceDecisionIds`. Las decisiones completas están en `InvoiceDetail.decisions`.

Propuesta de versión anterior: `409 POLICY_CHANGED`, estado `STALE`.
Activar no aprueba facturas ni las reevalúa automáticamente; el owner pide reevaluación explícita.
Reevaluar solo casos pendientes sin aprobación/reserva previa; si ya están resueltos,
`409 APPROVAL_NOT_ALLOWED`. Cada resultado nuevo se agrega al historial.
La extensión conversacional autorizada consulta hechos registrados y prepara propuestas con
confirmación humana; no sustituye la autorización formal. Su contrato está en
[CONVERSATION_FRONTEND_HANDOFF.md](CONVERSATION_FRONTEND_HANDOFF.md).

## 10. Cómo trabajar juntos y compartir este contrato

1. Oscar publica este documento en `oscar/backend` y Whady usa sus DTOs/ejemplos para las pantallas.
2. Integrar **solo el contrato** a `main` con un PR pequeño de documentación.
   No esperar a terminar todo el backend para compartirlo.
3. Whady actualiza su rama desde `main` y construye mocks con las mismas formas.
4. Oscar implementa los endpoints y el paquete compartido sin modificar las pantallas.
5. Sustituir mocks por HTTP por flujo: reglas → subida → lista/detalle → aprobación.
6. Oscar comunica cambios de nombre/tipo/body y los actualiza aquí y en los contratos compartidos en el mismo PR; Whady adapta los consumidores afectados.

Si `oscar/backend` todavía no está publicada, el archivo existe solo localmente.
Una vez subida, se puede compartir la URL de GitHub del archivo en esa rama; un push a la rama
no modifica `main` ni actualiza automáticamente el checkout de Whady.

Mensaje para enviarle a Whady (Oscar lo envía por su canal habitual):

> Dejé `docs/API.md` en `oscar/backend`: contrato v1 para frontend/backend, con modelos,
> rutas, ejemplos JSON, errores y estados de UI. Usa exactamente esos payloads para tus mocks.
> Yo mantengo el contrato de backend. Si te falta algún dato o acción para una pantalla,
> dímelo para incorporarlo; no cambies los nombres o formatos por tu cuenta.
> El norte sigue siendo `master_files/RETO_BLINKA.md`. Primero conectamos reglas,
> carga/listado/detalle de facturas y aprobaciones. Las delegaciones quedan para P1 y Hermes queda fuera del MVP. La extensión de chat autorizada se documenta en CONVERSATION_FRONTEND_HANDOFF.md.

### Checklist de integración

- [ ] Whady usa los DTOs para onboarding, Home, Bills, detalle, Rules y Approvals; reporta cualquier dato que falte.
- [ ] Los mocks respetan los nombres, estados, filtros y errores P0 definidos por Oscar.
- [ ] El frontend distingue decisión, estado técnico y revisión humana.
- [ ] La UI conserva decisiones y motivos operativos; no muestra avisos de demo, datos ficticios o dinero simulado, por decisión de Oscar.
- [ ] Se integra el contrato a `main`; cada uno continúa su implementación en su rama.
- [ ] Al implementar, los JSON de ejemplo y los esquemas compartidos se validan juntos.

Estado actual: P0 tiene endpoints, sesión demo, R2 privado, extracción, motor y persistencia.
D1 remoto `oli-demo` y Worker `oli-api` pertenecen a Tiamat; ver [operación y comprobaciones](../apps/api/README.md).
Los tests de integración usan D1/R2 locales reales y proveedores simulados; los smoke tests vivos
se registran por separado. PDF usa Mistral OCR y una lectura PDF_TEXT separada de Cloudflare;
el parser conservador acepta etiquetas conocidas y escala layouts desconocidos. PNG/JPEG
usan una transcripción separada de Qwen vía OpenRouter, comparada por el servidor con la
extracción primaria; una discrepancia o incertidumbre mantiene revisión. Consultar modos,
resultados medidos y límites en [EXTRACTION_SAFETY.md](EXTRACTION_SAFETY.md). No confundir
los tests de contrato con una evaluación OCR de los 50 documentos. Los tipos P1 de delegaciones siguen reservados.

El API es del mismo origen. En desarrollo, Whady debe usar un proxy `/api` hacia el Worker
o servir el frontend junto al API; no copiar la contraseña ni secretos al bundle. No hay CORS abierto.
`CONFIGURATION_CONFLICT` (409) indica que un proveedor/acuerdo cambió o su identidad está en uso.

## Integración con Telegram

Home separa Web y Telegram en pestañas con historiales y contexto independientes. El listado
`GET /chat/conversations?channel=WEB|TELEGRAM` devuelve solo ese canal (por defecto `WEB`),
con `channel` y `title` por conversación. El detalle incluye `channel`. El canal de escritura
lo fija el servidor: el navegador solo escribe Web; intentar enviar o repetir una clave de
Telegram desde Web devuelve `409 CHAT_CHANNEL_MISMATCH` antes de llamar al modelo.
La pestaña Telegram permite leer su historial y continuar en el bot.

La sección `/app/integrations` permite vincular y desconectar la cuenta de Telegram del usuario.
`GET /integrations/telegram` devuelve `TelegramIntegration`; `POST /integrations/telegram/link`
devuelve `201 TelegramLink` con un enlace temporal; `DELETE /integrations/telegram` responde `204`.
Las rutas mantienen sesión y CSRF. El usuario no envía claves de BotFather ni IDs de empresa.
El origen de factura también acepta `TELEGRAM`. Ver [flujo, configuración y garantías](TELEGRAM.md).

## Correo de Oli y bandeja de entrada

`GET /integrations/email` devuelve `EmailIntegration`; `POST` habilita una dirección estable
por empresa y `DELETE` pausa recepción. Habilitar/pausar requiere OWNER, sesión y CSRF.
`GET /inbox` devuelve `Inbox` con últimos 50 mensajes y `unreadCount`; `POST /inbox/:id/read`
marca lectura personal con respuesta `204`. Mensajes de otra empresa devuelven `404`.
Los tipos compartidos son `EmailIntegrationSchema`, `InboxSchema` e `InboxMessageSchema`.
El origen de factura acepta `EMAIL`. Los documentos siguen usando detalle y procesamiento
existentes. Ver [configuración, estados y garantías de correo](EMAIL.md).

## Oli Skill — integración autorizada para agentes externos

Esta extensión permite delegar facturas desde Hermes, OpenClaw, Grokbot u otro
agente con acceso HTTP. El paquete usa el formato `SKILL.md`; la instalación depende
del entorno consumidor. No introduce Hermes ni un VPS en la orquestación de Oli.
El panel **Integraciones → Oli Skill → Conectar agente** presenta comandos,
**Copiar prompt**, descarga y gestión de conexiones. El prompt contiene la URL
pública y el procedimiento; la key se configura por separado en el gestor de secretos.

### Administración humana

Todas estas rutas requieren sesión humana **OWNER**; las mutaciones exigen CSRF.
La base sigue siendo `/api/v1`.

| Método | Ruta | Entrada | Respuesta |
|---|---|---|---|
| GET | `/integrations/skill` | — | `{data: {connections: SkillConnection[]}}` |
| POST | `/integrations/skill/connections` | `{name}` (1–80 caracteres) | `201 {data: {connection: SkillConnection, apiKey}}` |
| PATCH | `/integrations/skill/connections/{id}` | `{expiresAt: ISO8601 \| null}` | `{data: SkillConnection}` |
| DELETE | `/integrations/skill/connections/{id}` | — | `204`, revocación irreversible |

`SkillConnection`: `id`, `name`, `keyPrefix`, `scopes`, `createdAt`, `expiresAt`,
`lastUsedAt`, `revokedAt`. **Las keys se crean sin caducidad (`expiresAt: null`)**.
El propietario puede establecer una fecha, cambiarla o quitarla, incluso si ya
venció. Cambiar la caducidad no reactiva una conexión revocada. Las fechas del
contrato son UTC; el editor del panel muestra la hora local de la persona.

La key completa solo se devuelve al crear la conexión; no se conserva en claro.
El servidor guarda SHA-256 de una credencial aleatoria de 256 bits. Listados,
auditoría y prompts no incluyen el secreto. El navegador la muestra temporalmente
sin persistirla en almacenamiento local ni en la caché de consultas.

### Consumo por agentes

Base configurada como `OLI_API_URL`: `https://<host>/api/v1/agent`.
Todas las llamadas llevan `Authorization: Bearer <OLI_API_KEY>`. No usan cookies ni
CSRF. Las credenciales de agente **no** autentican las rutas humanas.
El cliente se identifica con `User-Agent: Oli-Skill/1.0`; usar ese identificador
también al consumir con otras herramientas HTTP. El dominio puede rechazar el
identificador genérico de Python antes de que la solicitud llegue al Worker.

| Método | Ruta relativa | Entrada | Respuesta |
|---|---|---|---|
| GET | `/me` | — | `{data: {connection, organization: {id,name}, simulated: true}}` |
| POST | `/invoices` | Multipart `file` únicamente + UUID `Idempotency-Key` | `201 {data: Invoice}` |
| POST | `/invoices/{id}/process` | Cuerpo vacío | `200/202 {data: InvoiceDetail}` |
| GET | `/invoices/{id}` | — | `{data: InvoiceDetail}` |

Permisos fijos: `invoices:submit`, `invoices:read-own`, `invoices:process-own`.
La identidad y empresa proceden del hash de la key y su membresía vigente; no se
aceptan `orgId`, roles, extracción o decisiones del consumidor. La baja o cambio
de rol del OWNER emisor también deshabilita el acceso de sus conexiones.
No hay acceso a listar facturas de la empresa, archivos, proveedores, reglas,
revisiones humanas o acciones conversacionales. Una factura ajena devuelve `404`;
una operación fuera del alcance bajo `/agent/` devuelve `403 AGENT_SCOPE_DENIED`.
`approvalRequest.canApprove` siempre es `false` para el consumidor agente.

PDF/JPG/PNG hasta 5 MB, validación de documento, extracción, evaluación, colas,
reservas atómicas y revisión humana reutilizan el flujo existente. El canal visible
es `AGENT_REQUEST`. `agent_invoice_sources` registra la conexión emisora de forma
append-only y no permite atribuir el mismo documento registrado a varios canales.
Los eventos de agente se registran como `SYSTEM` con `details.connectionId`,
separados de las acciones del propietario humano. La carga verifica nuevamente la
conexión dentro del batch de registro, para rechazar una revocación concurrente.

La idempotencia se separa por conexión: reintentar el mismo archivo, nombre y UUID
no crea otra factura. Cambiar el documento con el mismo UUID da `409`.
Límite por conexión: 60 solicitudes/minuto; devuelve `429` con `Retry-After: 60`.
Una key ausente, incorrecta, revocada o vencida devuelve `401`.
`DECIDED` describe procesamiento; la autorización es `latestDecision.action` y
siempre es simulada. No se ejecutan pagos reales.

### Distribución y operación

Fuentes del skill: `apps/web/public/skills/oli/`. El build web empaqueta esa carpeta
en `/skills/oli-skill.tar.gz`, servido públicamente como asset sin credenciales.
El cliente `scripts/oli.py` usa Python 3.10+ y solo biblioteca estándar. Lee secretos
del entorno, rechaza redirecciones y admite HTTP únicamente para localhost.
Los agentes sin Python pueden consumir el contrato HTTP del propio skill.

Antes de desplegar esta versión, aplicar la migración **0010_oli_skill.sql** en D1;
reconstruir la web para distribuir el paquete actualizado. No aplicar un seed sobre
los datos existentes. Las pruebas de esta integración verifican permisos,
idempotencia y persistencia; no son métricas del extractor ni de decisiones end-to-end.


### Historial de reglas

`GET /api/v1/mandate/versions?page=1&pageSize=100` requiere sesión y devuelve
`Envelope<PolicyVersion[]>` con `pagination`. Orden: versión descendente. Incluye
la activa y las anteriores `SUPERSEDED`, con reglas, fecha e identidad de activación.
Solo expone versiones de la organización autenticada. Consultarlo no cambia el mandato,
no reactiva versiones ni afecta decisiones previas. Los borradores se consultan en `/mandate`.


### Papelera de facturas

`GET /invoice-trash?page=1&pageSize=100` devuelve `Envelope<InvoiceTrashEvent[]>`
con paginación y eventos de la empresa autenticada, del más reciente al más antiguo.
Cada evento incluye `id`, `invoiceId`, `invoiceName`, `trashed`, `at`, `userId` y
`userName`. El primer evento de cada factura determina su visibilidad actual.

`POST /invoices/:id/trash` requiere OWNER, CSRF e Idempotency-Key y recibe
`{ trashed: boolean, expectedEventId: string | null }`. Devuelve el evento registrado.
El servidor comprueba atómicamente el último evento; un estado obsoleto devuelve
`409 TRASH_CHANGED`. `trashed:false` restaura la factura. Cada acción se agrega al
registro de auditoría inmutable, sin borrado de filas ni de R2.

La papelera solo cambia visibilidad. No cancela trabajos, decisiones, solicitudes
humanas ni reservas. Los documentos permanecen dentro de los controles de duplicados,
acuerdos y presupuesto. Los endpoints financieros y las lecturas originales conservan
los registros; el cliente oculta eliminadas de la lista activa y permite consultarlas.
No existe estado PAID ni historial de pagos: APPROVE es autorización simulada.
