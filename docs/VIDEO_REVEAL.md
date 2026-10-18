# Oli — Reveal v1

Propuesta creativa para revisar con Oscar. Duración: aproximadamente 80 segundos. Copy principal en español; cierre de marca en inglés. Sin locución: Oli, la tipografía, el producto y la música cuentan la historia.

**Dirección confirmada por Oscar:** enfocar el video en Oli como mascota animada. Es la protagonista; los recortes de interfaz acompañan y demuestran su trabajo. Usar sus gestos y partículas originales. Los materiales están en `assets/reveal-demo/`.

## Propuesta de valor

**Payments infrastructure for agents.**

Tus agentes solicitan. Oli revisa. Tú defines los límites.

Oli recibe facturas de personas y agentes, las revisa contra las reglas de tu empresa y decide si autoriza, bloquea o necesita intervención humana. Puedes delegar la revisión repetitiva y consultar qué decidió y por qué.

La visión de marca abarca infraestructura de pagos para agentes. La demostración actual termina en decidir, registrar y explicar: las autorizaciones son simuladas.

## Features que sostienen el relato

1. **Un mandato definido por ti.** Proveedores permitidos, acuerdos, monedas, límites por factura, presupuesto por periodo y umbrales de revisión humana.
2. **Facturas desde donde trabajas.** Carga web, documentos por Telegram, adjuntos por correo y envío desde agentes externos mediante Oli Skill/API con permisos acotados.
3. **Lectura de documentos.** Extrae proveedor, monto, moneda y vencimiento de formatos soportados; una lectura incierta requiere aclaración y no permite autoaprobar.
4. **Tres resultados claros.** Autoriza dentro de las reglas, bloquea incumplimientos o solicita intervención humana según el caso.
5. **Controles antes de autorizar.** Comprueba duplicados, proveedor, acuerdos, límites y presupuesto. Una aprobación humana no elimina prohibiciones absolutas.
6. **Conversación con datos registrados.** Consulta facturas, presupuesto y actividad. Prepara cambios de proveedores y acuerdos que requieren confirmación explícita.
7. **Cada decisión deja rastro.** Documento original, datos, motivos, política aplicada e historial de acciones humanas y del sistema.

Fuentes: `master_files/RETO_BLINKA.md`, `docs/API.md`, `docs/CONVERSATION_FRONTEND_HANDOFF.md`, `docs/TELEGRAM.md`, `docs/EMAIL.md`. La conexión para agentes está documentada en la sección Oli Skill de `docs/API.md`.

## Guion de montaje

Referencia de edición: 125 BPM, compás 4/4. Un pulso dura 0,48 segundos; cuatro compases duran 7,68 segundos. Los bloques de ocho segundos son aproximados: los cortes definitivos se ajustan a los golpes del kick de la canción elegida.

| Tiempo | Copy exacto en pantalla | Imagen y movimiento | Música |
| --- | --- | --- | --- |
| 00–08 | **TUS AGENTES.** / **YA TRABAJAN.** | Negro. Primera frase enorme y recortada por los bordes. La segunda desplaza a la primera. Actividad abstracta de agentes se convierte en pequeñas tarjetas de solicitudes. | Pulso filtrado y textura. Dos golpes espaciados; dejar respirar cada frase. |
| 08–16 | **¿Y CUANDO** / **NECESITAN** / **GASTAR?** | Una solicitud avanza y se detiene ante un límite. GASTAR ocupa todo el encuadre. Último segundo: negro. | Sube la tensión. Cortar la música brevemente antes del reveal. |
| 16–24 | **HOLA, OLI.** / **TUS AGENTES SOLICITAN.** / **OLI REVISA.** | Entra Oli con su identidad visual real. Un pulso organiza las solicitudes a su alrededor. Primera aparición limpia del producto. | Primer drop. HOLA cae exactamente en el kick. Bajo completo. |
| 24–32 | **TÚ DEFINES** / **LOS LÍMITES.** / **PROVEEDORES.** / **ACUERDOS.** / **PRESUPUESTO.** | Recortes legibles de Reglas. Cada parámetro entra en una posición precisa y forma un marco que acompañará las decisiones. | Frases al kick; parámetros en subdivisiones más rápidas. |
| 32–40 | **WEB.** / **CORREO.** / **TELEGRAM.** / **TUS AGENTES.** | Cuatro entradas distintas convergen en una factura. Web y correo como recortes; Telegram en teléfono; agente como solicitud con identidad. Evitar código ilegible. | Cuatro impactos principales. Transiciones direccionales acompañan la percusión. |
| 40–48 | **LEE.** / **COMPARA.** / **VERIFICA.** | El documento se amplía. Proveedor, monto y moneda se separan en capas y se alinean con acuerdo, límite y presupuesto. La coincidencia aparece solo después de la comparación. | Tres golpes claros. Aumenta la densidad rítmica, con un momento para leer los datos. |
| 48–56 | **EN REGLA. AUTORIZA.** / **DUPLICADA. BLOQUEA.** / **SOBRE EL LÍMITE AUTOMÁTICO. TE CONSULTA.** | Tres casos distintos. Documento → condición → resultado. Ampliar AUTORIZA, BLOQUEA y TE CONSULTA; dejar la condición como contexto. Estados con texto e iconos. | Pico rítmico. Tres impactos; detener brevemente el movimiento en cada resultado. |
| 56–64 | **PREGUNTA.** / «¿Por qué se bloqueó?» / **ENTIENDE.** / «La factura está duplicada.» | Match cut del estado bloqueado a Ask Oli. Mostrar una respuesta real y abrir su factura vinculada. La frase propuesta es un objetivo de captura: usar la respuesta registrada al grabar. | Abrir espacio en el arreglo. Bajar la intensidad visual para leer la explicación. |
| 64–72 | **CADA DECISIÓN.** / **SUS REGLAS.** / **SU PORQUÉ.** | Del chat al detalle. Original, motivo y política aplicada entran en capas; convergen en un registro claro. Mantener un encuadre legible antes del cierre. | Segundo ascenso. Las capas entran con percusión; el último golpe deja espacio. |
| 72–80 | **AUTONOMÍA.** / **BAJO TUS REGLAS.** / **Oli** / **Payments infrastructure for agents.** | La tipografía llena el cuadro y se retira. Oli queda centrado. Lockup final quieto al menos tres segundos. | Dos impactos finales. Resolución del bajo y cola musical sobre la marca. |

## Dirección de motion y sonido

- **Oli protagonista.** Abrir con su presencia, revelar su rostro y volver a ella entre pruebas del producto. Escucha al configurar reglas, se concentra al verificar, dirige la mirada hacia una excepción y celebra después de una autorización real registrada. Sus expresiones son recursos visuales; el resultado financiero proviene del sistema.
- **Frases al kick.** En momentos seleccionados, construir palabras o grupos de palabras sobre golpes reales: «TÚ DEFINES / LOS LÍMITES», «LEE / COMPARA / VERIFICA», «AUTONOMÍA / BAJO / TUS / REGLAS». Alternar construcción acumulativa y reemplazo; sostener el resultado legible. No sincronizar todas las palabras de todo el video.
- **Escala extrema con pausas.** Alternar palabras que llenan el cuadro y encuadres con espacio. Cada bloque debe tener un foco claro.
- **El kick mueve la composición.** Cortes, cambios de escala y entradas principales caen en el golpe; hats y percusión secundaria activan detalles pequeños.
- **Movimiento con intención.** Las solicitudes convergen, las reglas delimitan, los duplicados se detienen y la excepción pasa a una persona. La animación explica la función.
- **Tipografía cinética.** Máscaras, recortes, cambios de peso y desplazamientos con frenada precisa. Las palabras clave llegan a reposo para poder leerlas.
- **Producto reconocible.** Usar identidad, mascota, tipografías y colores de Oli. Grabar la interfaz limpia y extraer los recortes necesarios; los detalles deben seguir siendo legibles.
- **Profundidad selectiva.** Parallax y perspectiva al pasar entre documento y datos. Para decisiones y motivos, volver a una vista frontal y estable.
- **Diseño sonoro integrado.** Añadir impactos y movimientos breves que compartan el ritmo de la pista. Reservar el silencio más evidente para la aparición de Oli.
- **Lectura antes de transición.** Los rótulos cortos pueden ir rápidos; las condiciones, respuestas y registros necesitan más tiempo. El cierre se sostiene.

## Material para producir

- Logo vectorial, mascota y tokens visuales actuales de Oli.
- Capturas limpias de Reglas, Facturas, detalle de decisión, Ask Oli e Integraciones.
- Tres casos ficticios verificados: autorización, duplicado bloqueado y solicitud por encima del límite automático. Los casos de demo y sus enlaces están en `docs/ENTREGA_20261018.md`.
- Un intercambio real de Ask Oli explicando un resultado registrado.
- Una pista con introducción, drop, espacio intermedio y resolución. Tras elegirla, convertir este guion en una lista de cortes por beat y frame.

## Precisión para la entrega

Mostrar autorización, bloqueo y revisión, sin representar transferencias bancarias. Incorporar una nota legible «Demo: autorizaciones simuladas» en la demostración de decisiones. Si se añaden métricas después, conservar muestra y versión: el reporte Ronda mide 20 documentos ficticios y no acredita exactitud universal. La autonomía progresiva del brief no forma parte de este reveal.

Este reveal abre la presentación. La demo funcional posterior demuestra las decisiones, la intervención humana y el registro; el reveal de 80 segundos no sustituye el recorrido del reto.
