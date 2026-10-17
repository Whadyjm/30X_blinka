# Motor de decisiones P0

`evaluateInvoice(invoice, context)` aplica las reglas del onboarding sobre un snapshot
del backend. Es una función pura: no llama modelos, consulta D1, cambia presupuestos
ni envía tokens. Usa los contratos existentes de `@oli/contracts`.

Devuelve `candidate` con `APPROVE`, `BLOCK` o `ESCALATE`, razones, explicación y traza
de operandos; también incluye proveedor/acuerdo resueltos, presupuesto compatible
y `requiresBudgetReservation`. **Un candidato `APPROVE` no es una aprobación persistida**:
el servicio debe revalidar el snapshot y guardar decisión/reserva con los triggers D1.
No publicar el candidato como `Invoice.latestDecision` antes de confirmar esa escritura.

## Datos del onboarding

No hay nombres, importes ni empresas fijos dentro del motor. El servidor debe cargar:

- Política **activada por OWNER**: moneda, automático, techo, umbral humano, presupuesto y requisitos.
- Proveedores y acuerdos de la empresa autenticada, incluyendo autorizados/inactivos.
- Presupuesto y reservas actuales del periodo empresarial seleccionado por el servidor.
- Antecedentes de facturas y reservas de esa misma empresa para comprobar duplicados.
- Lecturas del documento con hash e identidades construidos por los adapters del servidor.

El contexto es interno: nunca se acepta como autoridad desde el navegador o desde el JSON
del modelo. Los DTOs de proveedor/acuerdo/política no contienen `orgId`; el repositorio
debe filtrar por empresa antes de construir el contexto. Este paquete no autentica al llamador.

Los datos ficticios **ya existen**: [empresa de evaluación](../../fixtures/seed/company.json)
y [seed SQL demo](../database/seed/demo.sql). Comparten reglas iniciales de USD 300
automático, USD 1000 absoluto y USD 2000 mensual, pero son datasets con IDs distintos.
No importar el seed de evaluación sobre la organización demo existente sin un cargador aislado.
Ver [cómo se conectará el onboarding](../../docs/ONBOARDING_POLICY.md).

## Reglas aplicadas

- Reutiliza `checkExtraction()`; sin corroboración de los cuatro campos críticos no aprueba.
  Una advertencia mantiene revisión, aunque los campos corroborados permiten explicar
  otros incumplimientos. Un hash duplicado comprobado por el servidor puede bloquear
  incluso si falló el parser.
- Resuelve proveedor solo por nombre exacto normalizado (NFC, caja y espacios).
  Una posible duplicación con identidad ambigua se escala; no asigna un proveedor por parecido.
- Normaliza número de factura y comprueba hash, proveedor/número y obligaciones reservadas
  por acuerdo mensual/periodo o acuerdo de una sola vez. Excluye la propia factura del historial.
- `agreementReference` es una pista leída del documento: debe corresponder al proveedor
  resuelto y pasar actividad, moneda, importe/tolerancia y concepto. Sin referencia solo
  acepta un acuerdo activo inequívoco por proveedor, moneda y concepto; no inventa uno.
- Un acuerdo mensual exige `servicePeriod` explícito. Vencimiento anterior a emisión requiere revisión.
  P0 evalúa inmediatamente; fechas futuras/vencidas no activan un scheduler.
- Exige moneda y periodo de presupuesto compatibles; no convierte divisas. El periodo
  se proporciona en `context.budgetPeriodKey` desde el backend, no desde el PDF.
  Respeta el menor disponible entre la fila presupuestaria y el mandato vigente.
- Aplica techo absoluto y ambos umbrales (`automaticLimitMinor`, `reviewAboveMinor`).
  La igualdad no excede el límite. Si la revisión humana está desactivada, bloquea el exceso.
- Una excepción humana de importe solo se ofrece cuando no existen otros motivos de
  corrección o bloqueo. `BLOCK > ESCALATE > APPROVE`; conserva todos los motivos evaluados.
- La desactivación explícita de requisitos permite proveedores nuevos o facturas sin
  acuerdo según mandato. Un proveedor expresamente desautorizado permanece bloqueado.
- Configuración inválida, política no activa/futura, IDs duplicados y funciones P1
  aún no soportadas fallan sin candidato aprobable. Programación/delegaciones requieren
  implementación posterior, igual que su rechazo actual en el formulario P0.

## Comprobar y evaluar

Desde la raíz, con Node >=22.18:

```sh
npx --yes pnpm@12.14.0 --dir packages/contracts install --frozen-lockfile
npx --yes pnpm@12.14.0 --dir packages/domain install --frozen-lockfile
npx --yes pnpm@12.14.0 --dir packages/domain test
npx --yes pnpm@12.14.0 --dir packages/domain typecheck
node --experimental-strip-types scripts/run-policy-evaluation.mts
```

El runner genera [el informe](../../docs/evaluations/policy-engine-v1.json).
Ejecuta los 50 escenarios etiquetados **aisladamente**, con presupuesto e historial propios.
Lee los campos normalizados de las fixtures y construye corroboración **sintética**;
no envía documentos a un modelo ni utiliza `expectedResolution` para resolver proveedores.
`expected.action`, motivos y necesidad humana se usan exclusivamente al comparar resultados.
Las 17 aprobaciones son candidatos, no escrituras ni pagos ejecutados.

Estas métricas prueban la lógica sobre ese corpus, **no precisión OCR, seguridad end-to-end
ni transferencias**. Los casos históricos se evalúan contra sus snapshots presupuestarios
de prueba; no eligen un periodo de gasto desde la fecha del documento en producción.
El Worker ya conecta repositorios, commit atómico, sesión/rol y endpoints P0; ver
[apps/api](../../apps/api/README.md). La UI y el OCR independiente de imágenes siguen pendientes.
