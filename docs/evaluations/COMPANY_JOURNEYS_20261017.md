# Resultados de tres empresas ficticias de Oli

El ensayo programático completó sesenta recepciones sobre tres empresas nuevas. Hubo 56 documentos con decisión y cuatro fallos de lector. **Se observó una aprobación indebida de un duplicado en Brisa. El criterio de seguridad del reto no está superado.**

Los tres agentes se ejecutaron con modelo efectivo `gpt-6-luna`, uno por empresa. Crearon veinte documentos por empresa y revisaron sus resultados. El coordinador verificó las referencias antes de las llamadas reales y auditó las decisiones después de las corridas.

## Resultados medidos

| Empresa | Documentos intentados | Con decisión | Coinciden con el guion completo | Aprobaciones finales | Aprobaciones indebidas auditadas |
| --- | --- | --- | --- | --- | --- |
| Lumen Studio Demo LLC | 20 | 20 | 9 | 2 | 0 |
| Brisa Services Demo LLC | 20 | 18 | 8 | 3 | 1 |
| Cedro Logistics Demo LLC | 20 | 18 | 10 | 4 | 0 |
| Total | 60 | 56 | 27 | 9 | 1 |

La coincidencia con el guion exige acción inicial, motivos requeridos, necesidad de revisión humana, resultado final y variación de reserva esperados. Las abstenciones iniciales redujeron las reservas reales y cambiaron las condiciones presupuestarias de los casos posteriores. Por eso las 27 coincidencias no equivalen a una medida aislada de precisión del motor financiero.

Las decisiones finales se distribuyen en nueve aprobaciones simuladas, trece bloqueos y 34 escalaciones. Las 56 decisiones registradas tienen explicación. Se verificaron sesenta replays de subida, sesenta replays de procesamiento y sesenta descargas privadas con hash y rechazo de acceso anónimo. Hubo cuatro revisiones humanas simuladas: dos aprobaciones y dos rechazos. Lumen y Cedro ejercitaron la invalidación de una aprobación pendiente por cambio de versión de política.

Se hicieron 57 solicitudes a los lectores remotos y se reutilizaron tres lecturas de copias binarias, una por empresa. No hubo reintentos externos de los lectores. Los cuatro fallos fueron respuestas HTTP 400 con diagnóstico registrado `UPSTREAM_RATE_LIMIT`; quedaron como trabajos `DEAD`, sin decisión financiera ni reserva. No se trataron como éxitos ni se repitieron para mejorar el resultado.

El coste parcial reportado por respuestas exitosas fue USD 0,0827276: USD 0,07377017 del lector primario y USD 0,00895743 de la segunda lectura de imágenes. Puede excluir fallos, interrupciones o conversiones facturadas por separado. Las medianas de recorrido por empresa fueron 5,2695 s en Lumen, 5,944 s en Brisa y 5,3735 s en Cedro; son muestras pequeñas ejecutadas con tres empresas concurrentes.

## Aprobación indebida de Brisa

El caso 001 contenía el proveedor `Northstar Cloud Demo LLC` y número `NS-2601`. El lector primario obtuvo esos datos, pero el canal PDF separado no corroboró otros campos. La factura quedó en `ESCALATE` con `vendorId=null` y sin reserva.

El caso 012 presentó el mismo proveedor y número en otro archivo, con distinto importe y concepto. Ambos lectores pudieron corroborarlo y el motor resolvió su proveedor y acuerdo. El control de duplicado compara el `vendorId` del antecedente con el proveedor resuelto del candidato. Como 001 no tenía ese ID, 012 recibió `APPROVE` y reservó EUR 68,00.

La consulta del repositorio sí recuperó el antecedente por número. La brecha está en la evaluación de una identidad previa sin resolver: [motor](../../packages/domain/src/index.ts), regla `DUPLICATE_NUMBER`, y [selección de antecedentes](../../apps/api/worker/repository.js), función `snapshotInvoicesStatement`.

El runner inicial registró una aprobación inesperada, pero su contador `unsafeApprovals` quedó en cero porque excusaba cualquier resultado inesperado cuando el presupuesto real se desviaba del guion. Esa excepción era demasiado amplia. Una diferencia de saldo puede explicar un resultado presupuestario; no elimina un duplicado.

Los tres JSON originales permanecen intactos. La [auditoría estricta](company-journeys-audit-20261017.json) corrige el total a **una aprobación indebida**, conserva los hashes de las fuentes y reproduce la clasificación sin llamadas al modelo. El runner fue corregido para limitar la excepción a prohibiciones exclusivamente presupuestarias en corridas futuras. **El defecto del producto sigue pendiente; no se cambió ni desplegó el motor.**

## Cobertura de lectura y límites del conjunto

Varios PDF tuvieron los ocho campos primarios correctos, pero la lectura separada devolvió importe y moneda desconocidos. El sistema conservó las advertencias y escaló. En imágenes se observaron transcripciones con dos puntos duplicados en Brisa 006 y sin separadores en Cedro 016; el parser conservador no pudo interpretar todos los campos.

Lumen tiene encabezados con marcas distintas del proveedor explícito. En 006 el lector primario eligió una marca del encabezado mientras la segunda lectura siguió el campo de proveedor. También se encontró una discrepancia entre fecha visible y referencia en Lumen 017. Esas limitaciones de los fixtures se anotaron sin editar el conjunto ni sus resultados después de las llamadas reales. No se presenta la coincidencia literal con las referencias como precisión universal del extractor.

Las escalaciones cambiaron el presupuesto acumulado respecto de las precondiciones previstas. Los casos de presupuesto insuficiente y algunos de techo absoluto no llegaron a evaluar la regla buscada porque falló antes la corroboración. El resultado seguro de revisión no acredita que esas reglas se hayan demostrado en este ensayo.

## Alcance técnico

Cada empresa empezó con una organización y propietario nuevos, aprovisionados en D1 local. Mandato, activación, proveedores, acuerdos, recepción, consultas, revisiones y cierre de sesión utilizaron la API original. D1 y R2 se ejecutaron con Miniflare, en estado persistente separado por corrida. El presupuesto se acumuló sin reinicios entre casos.

Se usaron el consumidor durable, el motor y los triggers financieros originales, con transporte controlado de mensajes en memoria y entregas concurrentes. Los documentos se leyeron mediante el probe privado existente con lectores remotos reales, enviando exclusivamente bytes y MIME. No se escribió información financiera en producción, no se ejecutó navegador y no se probó el transporte remoto de Cloudflare Queues. La procedencia conserva la versión del lector; el runner no verificó independientemente el ID exacto del despliegue remoto.

Los documentos son nuevos y sus etiquetas quedaron fijadas antes de las llamadas reales. Los normales utilizan vocabulario explícito soportado por el parser. Los autotests anteriores emplean lecturas sintéticas y están separados de estos resultados. La preparación corrigió presupuestos incoherentes, referencias y delimitación de campos antes de medir; no se ajustó el producto contra este conjunto.

## Prioridades antes de otra demo

1. Impedir aprobación cuando un antecedente con el mismo número y proveedor aparente mantiene identidad sin resolver. Exigir aclaración ante ambigüedad; conservar historia y no asignar IDs por parecido.
2. Reproducir Brisa 001→012 con las lecturas reales guardadas, en D1/R2 limpios, antes y después de la corrección. Añadir regresión del motor y del servicio, comprobando ausencia de nueva aprobación y reserva.
3. Corregir la corroboración de PDF e imágenes con evidencia congelada, manteniendo contradicciones y advertencias bloqueantes. Separar los problemas de lectura de los defectos de referencias del conjunto.
4. Repetir los tramos de presupuesto y techo que no se ejercitaron, y medir otro conjunto reservado cuando se hayan usado estos casos para ajustar código.

## Artefactos

- [Auditoría consolidada y hashes de fuentes](company-journeys-audit-20261017.json).
- [Lumen corrida original](company-journey-lumen-2026-10-17T22-01-57-433Z.json) y [revisión](company-journey-lumen-review-20261017.md).
- [Brisa corrida original](company-journey-brisa-2026-10-17T22-01-40-441Z.json) y [revisión](../fixtures/company-journey/brisa/REVIEW.md).
- [Cedro corrida original](company-journey-cedro-2026-10-17T22-01-30-431Z.json) y [revisión](../fixtures/company-journey/cedro/REVIEW.md).
- [Documentos y reproducción](../fixtures/company-journey/README.md).
