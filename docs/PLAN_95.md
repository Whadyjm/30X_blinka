# Plan de cierre de Oli para el reto Blinka

Objetivo: llevar el MVP desde la valoración interna de 88/100 hasta una preparación defendible de 95/100, mediante controles documentales, evaluación nueva y una demostración completa. La nota es una valoración de preparación; el resultado del jurado dependerá de la entrega y de los demás equipos.

Fuente superior: [RETO_BLINKA.md](../master_files/RETO_BLINKA.md). Oscar mantiene backend, modelos y contrato API; Whady mantiene frontend. Todas las facturas son ficticias y las autorizaciones son simuladas.

Plazo confirmado por Oscar: **18 de octubre de 2026 a las 12:00 m de Caracas**. La candidata de backend y la muestra nueva tienen prioridad sobre funciones adicionales. El cierre se prepara sobre una versión publicada identificable, con evidencia de seguridad, autonomía y recorrido desde navegador. Después de la validación solo entran correcciones de bloqueos y seguridad; cada una obliga a repetir sus comprobaciones afectadas.

La [prueba posterior de tres empresas](evaluations/COMPANY_JOURNEYS_20261017.md) encontró una aprobación indebida de un duplicado cuando el antecedente tenía proveedor sin resolver. La [corrección local y su regresión](evaluations/PRIORITY_FIXES_20261017.md) ya impiden esa autorización sin reservar presupuesto. También recuperan formatos de lectura independiente y distinguen fallos transitorios tipados. La repetición con respuestas primarias congeladas mejora de 27/60 a 50/60 recorridos correctos y observa cero aprobaciones indebidas. La [candidata final](evaluations/FINAL_CANDIDATE_20261017.md) ya está publicada: la nueva muestra Ronda dio 20/20 decisiones completas correctas, 8/8 normales automáticas, 75% de autonomía y cero aprobaciones indebidas observadas. Los dos recorridos humanos y el control P0 adicional pasaron. La [verificación de escritorio y móvil](evaluations/candidate-final-browser-20261017.json) pasó veinte pantallas. Las lecturas no fueron perfectas en todos los campos: el reporte distingue exactitud literal, equivalencia de política y decisiones. Quedan el ensayo del equipo y las limitaciones documentales descritas abajo; no se afirman como resueltas.

## Punto de partida

La [última corrida completa de PDF](evaluations/invoices-pdf-2026-10-17T16-48-33-680Z.json) registró 50/50 decisiones correctas, 49/50 documentos con ocho campos exactos, 31/50 casos resueltos correctamente sin intervención y cero aprobaciones indebidas observadas. Usó lectores remotos reales y D1/R2 locales aislados por escenario. Es regresión sobre documentos ya utilizados para ajustar el sistema.

La auditoría local del 17 de octubre de 2026 pasó 303 pruebas: API 124, dominio 78, contratos 28, extracción 26, D1 14 y web 33. También pasaron typecheck y compilación web. Estas pruebas no sustituyen una medición de decisiones con documentos nuevos.

## Orden y responsables

Las estimaciones son horas de trabajo activo, orientativas. Oscar y Whady pueden trabajar en sus áreas en paralelo una vez acordado el contrato de evaluación. La fecha de entrega determinará cuánto tiempo dedicar a cada bloque.

| Orden | Trabajo | Responsable | Esfuerzo orientativo | Dependencia |
| --- | --- | --- | --- | --- |
| 1 | Identificar una versión candidata y preparar datos aislados | Oscar y Whady | 30–45 min | Ninguna |
| 2 | Conectar evaluación verificable con la pantalla existente | Oscar API y contrato; Whady presentación | 1–2 h por área | 1 |
| 3 | Cerrar controles documentales y ejecutar regresión | Oscar | 2–4 h | 1 |
| 4 | Medir un conjunto nuevo reservado | Oscar; revisión de documentos y etiquetas por Whady | 1–2 h | 2 y 3 |
| 5 | Verificar el recorrido completo sobre la candidata final | Oscar y Whady | 1–2 h | 4 |
| 6 | Ensayar presentación y preparar respaldo | Oscar y Whady | 45–60 min | 5 |

## 1 Preparar una candidata identificable

- [x] Revisar y consolidar únicamente cambios propios, preservando el trabajo concurrente.
- [x] Registrar commit y hashes de los archivos pertinentes, migraciones, versión del Worker y configuración de lectores. Identificar el bundle frontend que se sirve.
- [x] Preparar una empresa ficticia de ensayo con proveedores, acuerdos y presupuesto coherentes con el guion. Usar un entorno aislado y conservar la base compartida existente.
- [x] Preparar el conjunto reservado antes de tocar lectores o prompts; conservarlo sin ejecutar hasta el bloque 4.

Termina cuando cada prueba y reporte identifica exactamente el código y la configuración que evalúa. Los cambios posteriores obligan a repetir las comprobaciones afectadas.

## 2 Mostrar evidencia verificable dentro de Oli

Hoy `GET /api/v1/evaluation/summary` devuelve `data:null`. Reutilizar la página Evaluation y los reportes existentes mediante un resumen validado en servidor. Servir un reporte histórico identificado no requiere invocar modelos desde la pantalla.

- [x] Oscar conecta el endpoint a una corrida inmutable identificada y valida sus contadores; nunca reconstruye respuestas esperadas como resultados observados.
- [ ] Ajustar `packages/contracts`, `docs/API.md` y el adapter web según el alcance necesario. El adapter actual devuelve `groups:[]` y `cases:[]`; exponer el detalle si se ofrece comparación por caso.
- [x] Incluir fecha, versión evaluada, dataset, tamaño, alcance y origen de las mediciones. Identificar por separado regresión, conjunto reservado, lectores solos y procesamiento completo.
- [ ] Whady muestra decisiones correctas, aprobaciones indebidas observadas, autonomía y cobertura de explicación, con acceso al detalle o al reporte correspondiente.
- [x] Un cambio de versión permite reconocer que un reporte es histórico y qué versión midió. Una caída del endpoint muestra error, sin cifras de respaldo inventadas.

Termina cuando las cifras visibles coinciden con el archivo fuente y una persona entiende qué se midió. El 62% actual de autonomía no se incrementa cambiando el denominador ni convirtiendo escalaciones esperadas en aprobaciones.

## 3 Cerrar controles documentales

Mantener [EXTRACTION_SAFETY.md](EXTRACTION_SAFETY.md), el motor puro y la reserva única mediante triggers D1.

- [ ] Aplicar un máximo propuesto de cinco páginas PDF antes de invocar lectores, con un parser que pueda acreditar el número. Si no se puede verificar, fallar de forma segura con explicación. No contar páginas mediante búsqueda de texto dentro del binario.
- [ ] Validar aritmética explícita de formatos soportados: líneas, subtotal, impuestos, descuentos y total. Usar unidades menores y reglas de redondeo explícitas. Datos incompletos o contradictorios requieren revisión; no completar valores por inferencia.
- [ ] Los PDF o imágenes sin desglose conservan las comprobaciones existentes de total y acuerdo. No afirmar validación de líneas si no existen o no se han leído.
- [ ] Conservar todas las advertencias bloqueantes, procedencia del servidor, comprobaciones de política vigente y commit atómico. Una coincidencia entre lectores permite evaluar reglas; no concede aprobación por sí sola.
- [ ] Cubrir el límite de páginas y las contradicciones aritméticas con pruebas pequeñas y casos documentales reales ficticios. Revisar que una factura válida siga pudiendo resolverse automáticamente.
- [ ] Repetir pruebas locales afectadas y la regresión documental sobre los formatos modificados. Si cambia schema o prompt, actualizar versión de lectura y comprobar invalidación de caché.

Termina cuando documentos contradictorios o fuera del límite no reciben autorización y los formatos soportados mantienen autonomía. Si el soporte aritmético completo excede el tiempo disponible, acotar los formatos y documentar la revisión obligatoria de los no interpretables; no presentar la cobertura pendiente como resuelta.

## 4 Medir documentos nuevos sin ajustar las respuestas

Preparar 20 documentos ficticios: ocho facturas normales elegibles para aprobación automática, ocho trampas financieras o de lectura y cuatro documentos negativos o claramente inciertos. Variar proveedor ficticio, importe, concepto y diseño; incluir PDF, PNG y JPEG. Usar varios diseños, no solo cambiar cifras de la plantilla existente.

Las trampas deben cubrir duplicados, proveedor desconocido, desacuerdo comercial, exceso del automático con revisión humana, exceso del techo, presupuesto insuficiente, moneda o fecha ambigua y contradicción de totales. Los negativos incluyen comprobante, cotización, nota de entrega e imagen ilegible.

- [ ] Fijar hashes, campos esperados, acción, necesidad humana, contexto de presupuesto y antecedentes antes de ejecutar. Revisar etiquetas visualmente entre ambos responsables.
- [x] Reutilizar el runner existente con cambios mínimos para el nuevo manifest y el procesamiento completo. El runner actual de holdout mide lectores; por sí solo no mide decisiones financieras.
- [x] Enviar al lector exclusivamente el documento. Políticas, acuerdos y etiquetas permanecen en servidor y harness, fuera de la entrada del extractor.
- [x] Separar cada escenario y su contexto. No cargar los 50 casos históricos juntos en una empresa: sus presupuestos y antecedentes son independientes.
- [x] Ejecutar una corrida completa acotada por llamadas y coste; incluir fallos técnicos y abstenciones en el reporte. No reintentar un resultado incierto buscando uno favorable.
- [x] Comparar decisión, motivos requeridos, necesidad humana, campos aprobados y reserva. Conservar latencias y uso reportado.

Objetivos fijados antes de medir: cero aprobaciones indebidas observadas; 20/20 decisiones con explicación; al menos 19/20 decisiones completas correctas; al menos siete de las ocho facturas normales aprobadas automáticamente con campos correctos. El resto debe mantener revisión o bloqueo seguro. Los objetivos se cumplieron en la corrida final Ronda, con el alcance y la auditoría de publicación concurrente indicados en el informe final.

Si se usa un fallo para modificar código o prompts, conservar esa corrida como fallida y reclasificar el conjunto como regresión. Preparar otra muestra reservada para volver a afirmar generalización.

## 5 Verificar interfaz cola y persistencia juntas

Usar la versión candidata final en el entorno de ensayo y lectores reales. Recorrer desde navegador hasta la decisión y reserva persistidas. Preparar seis casos principales y dos controles adicionales, con números y presupuesto acumulado calculados antes del ensayo.

| Caso | Resultado que debe demostrarse |
| --- | --- |
| Factura válida | Aprobación simulada, explicación y una reserva |
| Segunda copia | Bloqueo por duplicado y ninguna reserva adicional |
| Proveedor desconocido | Bloqueo sin alta automática |
| Diferencia con acuerdo | Revisión sin una excepción humana genérica |
| Importe entre automático y techo | Solicitud humana; confirmación revalidada y una reserva |
| Presupuesto insuficiente | Bloqueo incluso si una persona intenta autorizar |
| Cambio de reglas con revisión pendiente | Rechazo de la solicitud obsoleta y conservación del historial |
| Doble envío o confirmación concurrente | Una sola autorización y una sola reserva |

- [x] Verificar estados de procesamiento, enlace privado al original, explicación e historial en escritorio y móvil.
- [x] La acción principal y el siguiente paso deben ser comprensibles sin abrir código ni JSON. Una lectura incierta debe indicar que requiere documento corregido; reanalizar aplica reglas a la lectura guardada.
- [x] Registrar versión, IDs ficticios, decisiones, reservas y resultado del replay. Conservar capturas o vídeo del recorrido, sin credenciales.
- [ ] Si se demuestra correo con imágenes inline, completar el reenvío real pendiente descrito en [EMAIL.md](EMAIL.md). Si no se verifica, excluir ese recorrido del guion.

Termina cuando los ocho casos cumplen su expectativa en la candidata final. Un fallo de seguridad detiene el cierre; un fallo del proveedor queda registrado y se muestra como estado técnico, nunca como una aprobación.

## 6 Presentar el valor en cuatro minutos

| Tiempo | Qué mostrar |
| --- | --- |
| 0:00–0:30 | Problema de finanzas y mandato configurado por la empresa |
| 0:30–1:15 | Documento válido entra y obtiene autorización simulada con explicación |
| 1:15–2:00 | Duplicado y presupuesto insuficiente quedan frenados |
| 2:00–2:45 | Excepción de importe solicita revisión y registra la decisión humana |
| 2:45–3:30 | Historial, política aplicada, reserva y replay sin efectos duplicados |
| 3:30–4:00 | Resultados medidos, alcance y límites de la prueba |

Mensaje central: «Oli revisa las facturas, autoriza las que cumplen el mandato, frena las que lo incumplen y pide una decisión humana cuando corresponde. Cada decisión queda registrada y explicada».

- [ ] Ensayar dos veces sobre datos frescos aislados, sin editar contadores ni borrar historial para recuperar el estado.
- [x] Tener videos de consulta de decisiones reales y reportes descargables como respaldo, identificados como grabación y medición previa; no se presentan como una nueva lectura ni como grabación de cada clic humano original.
- [x] Preparar respuestas sobre qué pasa si el lector se equivoca, cambia la política, llega el mismo documento dos veces o se cae el proveedor.
- [ ] Congelar funcionalidades cuando comience el ensayo final; admitir solo correcciones de bloqueos o seguridad y repetir los controles afectados.

## Criterios de cierre de 95

La valoración interna puede subir si se cumplen los resultados y no aparecen regresiones:

| Área | Actual | Objetivo interno | Evidencia necesaria |
| --- | --- | --- | --- |
| Reglas y motor | 19/20 | 19/20 | Mantener la cobertura y las garantías existentes |
| Seguridad | 23/25 | 24/25 | Controles documentales y ningún caso nuevo indebidamente aprobado |
| Extracción | 17/20 | 18/20 | Campos correctos en todas las aprobaciones y medición nueva |
| Autonomía | 12/15 | 14/15 | Objetivos del conjunto nuevo, sin relajar controles |
| Explicabilidad | 9/10 | 10/10 | Resultados visibles y decisiones comprensibles en el recorrido real |
| Entrega | 8/10 | 10/10 | Ocho recorridos verificados y dos ensayos sobre la misma candidata |
| Total | 88/100 | 95/100 | Cumplimiento conjunto de los criterios anteriores |

Si queda menos de una jornada, priorizar candidata identificada, evaluación visible, ensayo completo y una muestra nueva acotada. Reducir el tamaño de la muestra y declarar su alcance antes que omitir controles o anunciar validaciones sin ejecutarlas. Lo que no se complete permanece pendiente y afecta a la valoración final.

Quedan fuera de este cierre nuevas integraciones, pagos reales, Hermes/VPS, rediseños generales y una edición manual de campos que pueda eludir la corroboración. Se retoman después de asegurar el entregable del reto.
