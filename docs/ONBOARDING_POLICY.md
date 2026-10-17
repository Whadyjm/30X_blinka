# Del onboarding al motor

Los datos de la empresa los confirma el usuario. El motor recibe una versión activada
de esa configuración y el estado actual de D1; no inventa reglas ni usa el texto libre
de una factura o de una conversación para conceder autoridad.

| Paso del onboarding | Datos | Contrato / destino |
|---|---|---|
| Presentar empresa | Nombre, moneda, zona horaria | Organización de la sesión demo |
| Dar el mandato | Automático, techo, presupuesto, umbral y revisión humana | `SaveMandateDraftSchema` → `policy_drafts` |
| Presentar proveedores | Nombre y si está permitido | `CreateVendorSchema` → `vendors` |
| Definir acuerdos | Proveedor, moneda, importe, tolerancia, concepto y frecuencia | `CreateAgreementSchema` → `agreements` |
| Confirmar mandato | Revisión explícita del OWNER | `ActivateMandateSchema` → `policy_versions` activa y presupuesto |

Guardar el borrador no concede permisos. Los IDs, roles, empresa y versiones se asignan
o comprueban en el servidor. Al procesar una factura, el backend carga esa política
vigente, proveedores/acuerdos, presupuesto y antecedentes; el motor recibe ese snapshot.
Cambiar el onboarding y activar otra versión cambia las decisiones futuras sin modificar
el código del motor. Las decisiones previas conservan su política y evidencia originales.

## Ejemplo ficticio ya preparado

[fixtures/seed/company.json](../fixtures/seed/company.json) contiene la empresa
**Aurora Demo Labs LLC**, proveedores y acuerdos usados en los 50 escenarios.
Reglas iniciales:

- USD como moneda; USD 300 por factura dentro del automático y del umbral humano.
- USD 1000 como techo absoluto; USD 2000 de presupuesto mensual.
- Proveedor permitido y acuerdo activo obligatorios, tolerancia cero.
- Revisión humana habilitada para excesos autorizables; sin programación ni delegaciones P1.

Con el contexto de cada escenario: Nimbo Cloud Demo por USD 50 cumple el mandato;
Acme Accounting Demo por USD 450 requiere autorización humana; Delta Supplies Demo
queda bloqueado por no estar permitido. Un acuerdo de importe distinto o un saldo
insuficiente impiden aprobar aunque el importe sea pequeño.

La base remota `oli-demo` usa el [seed SQL mínimo](../packages/database/seed/demo.sql),
con otros nombres/IDs y las mismas reglas iniciales. Es una configuración demo real
ya guardada, separada del corpus de evaluación. Los datos sintéticos pueden mostrarse
como ejemplo en el onboarding, identificados como demo y sujetos a confirmación humana.

## Qué está conectado

Los contratos, datos ficticios y [motor puro](../packages/domain/README.md) existen.
La pantalla de Whady y los endpoints de guardar/activar mandato todavía deben conectarse
siguiendo [docs/API.md](API.md). El motor no depende de que esa pantalla esté terminada
para poder probar su comportamiento con snapshots sintéticos.

Una respuesta `candidate.action=APPROVE` requiere un commit seguro en D1 antes de aparecer
como aprobación en la web. La base confirma reserva y decisión juntas; el motor no
incrementa el presupuesto por su cuenta. Los pagos de prueba en Polygon siguen siendo
una integración posterior y no forman parte de esta implementación.
