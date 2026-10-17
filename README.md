# Oli para el reto Blinka

Oli lee facturas de una empresa ficticia y decide si autoriza, frena o solicita revisión humana según su mandato. Guarda la decisión, la política aplicada y una explicación. Las autorizaciones y reservas son simuladas; no mueve dinero.

**Aplicación:** [oli30x.ultramare.dev](https://oli30x.ultramare.dev). **Alcance:** [reto original](master_files/RETO_BLINKA.md). **Entrega:** [guion, evidencia y horario](docs/ENTREGA_20261018.md).

## Recorrido de demostración

1. Entrar con el acceso de demostración facilitado por Oscar o Whady.
2. Abrir Reglas: definir límite automático, techo, presupuesto, proveedores permitidos y acuerdos; confirmar el mandato.
3. Cargar una factura ficticia en Facturas y esperar el resultado de los lectores y la cola.
4. Abrir el detalle para ver el original privado, los datos leídos, las reglas y la explicación. Una excepción admisible solicita decisión humana; una lectura incierta requiere aclaración y no permite saltarse el control.
5. Revisar el historial y el presupuesto. Repetir una petición no crea otra reserva; una segunda copia se evalúa como duplicado.
6. Abrir Evaluación para consultar la medición histórica identificada. Su dataset y versión son los evaluados, aunque la interfaz se haya actualizado después.

Los documentos, acuerdos y expectativas están en [fixtures de empresas](docs/fixtures/company-journey/README.md). Los reportes originales conservan también errores técnicos y abstenciones. Las muestras usadas para corregir el sistema se presentan como regresiones, no como pruebas nuevas.

## Desarrollo y comprobaciones

- [API, configuración local y despliegue](apps/api/README.md).
- [Frontend y modos de ejecución](apps/web/README.md).
- [Contrato HTTP](docs/API.md) y [schemas compartidos](packages/contracts/README.md).
- [Motor de política](packages/domain/README.md), [lectores](packages/extraction/README.md) y [base de datos](packages/database/README.md).
- [Garantías de lectura](docs/EXTRACTION_SAFETY.md) y [plan de cierre](docs/PLAN_95.md).

Para ejecutar la suite de API con las dependencias instaladas:

```sh
cd apps/api
node --test --test-concurrency=1 tests/*.test.mjs
```

El self-test de una empresa usa lecturas sintéticas y verifica el recorrido, no la exactitud OCR. Las corridas reales quedan separadas e identifican versión, documentos y resultados observados. No se debe repetir una lectura incierta hasta obtener una respuesta favorable.

## Arquitectura y límites

El Worker coordina lectores independientes, motor puro de reglas, cola durable, D1 y R2. El servidor calcula hashes e identidades de evidencia. D1 reserva presupuesto de forma atómica al registrar una autorización; el historial conserva procesamiento, decisión y revisión humana por separado.

La evaluación cubre documentos ficticios en formatos soportados. No acredita lectura universal, validación completa de líneas e impuestos ni ausencia de errores futuros. El proveedor de modelos puede fallar; los intentos son acotados y su agotamiento no concede autorización. El alcance del reto termina en decidir, registrar y explicar, sin transacciones bancarias ni verificaciones regulatorias.
