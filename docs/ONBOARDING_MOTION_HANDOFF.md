# Onboarding de Oli: diseño y continuación en Claude

## Encargo de Oscar

Primero mejorar el onboarding existente usando App Llama: hacerlo amigable, con Oli
y sus estados como protagonista que invita y explica las funciones. Después pasarlo
a Claude para aplicar motion graphics y lograr una experiencia fluida y agradable
que termine en la pantalla principal.

## Primera fase implementada

- Un único Oli persistente acompaña los cinco pasos en una columna lateral en
  escritorio y encima del contenido en móvil. Mantener el canvas montado entre pasos.
- Oli saluda por el nombre y explica cada decisión en primera persona. Estados:
  `happy`, `listening`, `understanding`, `focused`, `thinking`, `celebrating`.
- Tres controles muestran qué hacen Facturas, Aprobaciones y Chat. Son explicaciones
  de producto, no decisiones de ejemplo ni resultados reales.
- Secuencia: tu espacio → tus reglas → proveedores/acuerdos → confirmación → primera
  factura opcional. El paso final permite cargar un PDF de ejemplo o ir al inicio.
- Se conservan formularios, API, revisión de reglas, confirmación explícita y
  navegación final `replace('/app')`. Factura recibida no significa aprobada.
- Textos EN/ES, foco en el título al avanzar y respeto de Reduce Motion para Oli.
- Al crear una organización, la carga inicial de reglas no desmonta el onboarding
  cuando ya existe el borrador local.

## Investigación App Llama

Se consultaron 60 referencias mediante búsqueda de nombres y búsqueda semántica,
además de las primeras diez entradas del onboarding de Duolingo, Finch y Headspace.
Se descargaron y compararon visualmente las 27 imágenes de esos tres flujos.
Material de trabajo local: `/tmp/oli-onboarding-research/board.jpg` y
`/tmp/oli-onboarding-references.json` (las URLs expiran).

Referencias seleccionadas por app_id/screen_id:

| Referencia | Patrón aplicado |
| --- | --- |
| Duolingo `570060128/onb_5m5dr` | Presentación de la mascota con una invitación breve |
| Duolingo `570060128/onb_2fasx` | Guía presente durante una decisión, progreso claro |
| Duolingo `570060128/onb_5mcra` | Estado de trabajo explicado por la mascota |
| Finch `1528595748/onb_hezq5` | Personalización cercana junto al formulario |
| Finch `1528595748/onb_ijaxd` | Celebrar una configuración terminada |
| Headspace `493145008/onb_9xd9e` | Explicar valor antes de pedir configuración |
| Headspace `493145008/onb_w0ot0` | Acción opcional con salida visible |

Se preservó la identidad existente: Inter, blanco/hueso/tinta, acento highlighter,
sin sombras decorativas. No copiar colores, mascotas ni el watermark de referencias.

## Segunda fase: Claude toma la implementación

Trabajar en este mismo checkout sobre los cambios sin commit de la primera fase.
Revisar `git status` antes de editar; existe trabajo concurrente que puede actualizar
HEAD. No revertir, stagear ni publicar cambios ajenos. No desplegar por este encargo.

Diseñar e implementar una secuencia de motion con intención:

1. Entrada de bienvenida con Oli protagonista, sin ocultar controles esperando una
   animación ni añadir una pantalla de marketing obligatoria.
2. Continuidad entre pasos: Oli permanece, cambia su expresión y el contenido se
   transforma con dirección clara. Transiciones de avance y retroceso coherentes.
3. Feedback discreto al escribir, cambiar vista previa, guardar, confirmar y cargar.
   Los datos que se están leyendo deben permanecer quietos.
4. Una celebración breve tras activación confirmada por el servidor. No inventar
   progreso ni mostrar éxito anticipado; no reactivar reglas al terminar una animación.
5. Cierre al pulsar la acción final: una transición que conecte con `/app` y revele el
   dashboard. Una sola navegación, sin pantalla vacía ni posibilidad de volver al
   onboarding completado. El salto opcional también debe terminar bien.

Preferir CSS/WAAPI y herramientas ya instaladas. Añadir una librería solo si resuelve
una necesidad real. No convertir esta app React/Vite web en React Native. Mantener
accesibles todos los controles, el teclado, foco, scroll y el modo de movimiento reducido;
la preferencia debe quitar desplazamientos y loops, permitiendo una salida inmediata.
Limpiar listeners, temporizadores y animaciones al desmontar. Evitar carreras de doble
clic y no retrasar solicitudes por motivos decorativos.

## Archivos principales

- `apps/web/src/pages/Onboarding.tsx`
- `apps/web/src/features/onboarding/OliGuide.tsx`
- `apps/web/src/styles/onboarding.css`
- `apps/web/src/i18n/es.onboarding.ts` y su import en `es.ts`
- `apps/web/src/hooks/usePrefersReducedMotion.ts`
- `apps/web/src/components/Oli.tsx`, renderer en `packages/oli/src/renderer.js`
- `/tmp/oli-onboarding-desktop.png`, `/tmp/oli-onboarding-mobile.png`

## Verificación y límites

Antes del handoff: build TypeScript/Vite, 24 tests del frontend y comprobación de
735 claves ES pasaron. El detector de Impeccable no reportó hallazgos. Se inspeccionó
la composición a 1280×900 y 390×844. Los tests de contrato/chat no miden extracción
ni decisiones end-to-end. El recorrido de interfaz usa la API mock y datos ficticios.

Para ejecutar: `npm run dev:mock -- --host 127.0.0.1` en `apps/web` (servidor de esta
sesión en 5173). En navegador local, el control de desarrollo para reiniciar onboarding
es `import('/src/api/mock/mock-api.ts').then(m => m.mockControls.startOnboarding())`
y después recargar `/onboarding`. Solo usar ese control en localhost con mock.
La app live permite revisar reglas existentes en `/onboarding?restart=1`.

Claude debe verificar el recorrido completo con y sin carga opcional, errores,
retroceso, activación deshabilitada antes del checkbox, doble clic, ES/EN,
viewport estrecho y Reduce Motion. Grabar/revisar la secuencia animada completa;
no afirmar 60 fps si no se midieron. Ejecutar build, tests y checker i18n después
del cambio. Entregar resultado y limitaciones reales al usuario.

## Segunda fase implementada (motion)

- Entrada escalonada de Oli, workspace y progreso (transform/opacity; controles activos desde el primer frame).
- `go()` registra la dirección: el contenido del paso y el texto de Oli entran desde la derecha al avanzar y desde la izquierda al retroceder. El canvas de Oli sigue montado; WAAPI da un pulso al cambiar de expresión.
- La barra de progreso rellena con `scaleX`. Ráfaga de puntos única en el paso 5, solo tras `activate` confirmado por el servidor.
- Cierre: una única `nav('/app', { replace: true, viewTransition: true })`, sin esperas; `leaveLock` evita doble disparo y `nextLock` evita doble activación.
- Reduce Motion: sin animaciones de entrada, bucles, ráfaga ni view transition.
- Corrección: dos hijos de `OliGuide` compartían `key={step}` y React dejaba copias duplicadas; ahora las claves son distintas.
- Límites: fps no medidos; Reduce Motion verificado por reglas CSS, no emulado en navegador; el cross-fade del view transition depende del soporte del navegador (si falta, navega sin transición).

## Iteración conversacional: burbujas, escritura y mirada

Por pedido de Oscar, cada paso presenta tanto el mensaje de Oli como el encabezado
del formulario en burbujas que apuntan hacia la mascota. `OliTypedText` revela las
letras con CSS conservando el espacio completo y una copia accesible del mensaje.
No hay esperas para usar los controles ni anuncios de lector de pantalla por letra.

El wrapper web de Oli ofrece `followCursor` como opción: solo el onboarding la
activa. Usa `lookAt()` del renderer existente, limita actualizaciones a un frame y
limpia listeners al desmontar. Captura de input en todo el formulario comunica
escritura mediante `listening`, seguida de `happy` al hacer una pausa; sus timers
se cancelan al cambiar de paso, salir del campo o desmontar.

Esta iteración sí verificó Reduce Motion emulado en Chrome vía CDP: texto completo,
sin animación de letras y seguimiento de cursor detenido. Se comprobaron los cinco
pasos, escritura de empresa/límites/proveedores, mirada en ambas direcciones,
persistencia del mismo canvas, ausencia de desplazamiento al revelar texto,
confirmación antes de activar y salida al inicio. Evidencia:
`docs/evaluations/onboarding-bubbles-20261017.json`. Solo API mock/datos ficticios;
fps y exactitud del extractor no medidos.

## Pantallas cortas dentro de cada bloque

Las reglas se dividen en aprobación/revisión, presupuesto/techo y comprobaciones.
Los proveedores se dividen en proveedores y acuerdos. Se conservan los cinco bloques
principales y se añade progreso «Parte n de total» dentro de estos dos bloques.
Continuar valida los campos de la pantalla actual; solo el último tramo de reglas
guarda el borrador. La activación conserva la confirmación final explícita.

Atrás recorre las partes en orden inverso y preserva los valores. Los paneles de
proveedores y acuerdos permanecen montados al cambiar de parte para conservar
también sus formularios sin guardar. La API y sus reglas no cambian.

En móvil, la mascota se compacta junto a una sola burbuja, el encabezado repetido
queda disponible al lector de pantalla y las acciones permanecen accesibles al
desplazarse. Las comprobaciones obligatorias conservan su resumen visible y el
detalle completo desplegable. Los acuerdos guardados y los ajustes de frecuencia
y tolerancia se pueden desplegar; sus valores actuales se ven en el resumen.

`MandateForm.section` y `VendorsPanel`/`AgreementsPanel.compact` son opcionales.
El editor general de Reglas conserva sus cuatro importes y sus comprobaciones.
Verificación: navegación completa, validación por parte, persistencia al retroceder,
confirmación, movimiento reducido y editor general en Chrome con API mock.
Evidencia: `docs/evaluations/onboarding-short-sections-20261017.json`.
