# Propuesta de inicio conversacional

URL publicada: https://oli30x.ultramare.dev/propuesta/.

Superficie aislada para revisar con Whady. Conserva los neutros cálidos, Inter y amarillo del frontend; pone a Oli y la intención del usuario antes de los indicadores. No modifica `apps/web`, `oli-api`, sus datos ni `packages/oli`. Reutiliza la API Canvas del mismo paquete que usa el wrapper React del personaje.

```sh
node --test examples/conversation-proposal/model.test.mjs
node examples/conversation-proposal/build.mjs
python3 -m http.server 4175 --directory examples/conversation-proposal/dist
# http://localhost:4175/propuesta/
apps/api/node_modules/.bin/wrangler deploy --config examples/conversation-proposal/wrangler.jsonc
```

Worker estático separado, cuenta Tiamat, rutas exclusivas `/propuesta` y `/propuesta/*`. No tiene bindings D1/R2/AI. No usar este despliegue para publicar la aplicación principal. CSP impide conexiones a APIs; fuentes y renderer son locales. El build toma una copia del renderer actual, sin editar ni publicar su paquete fuente.

## Qué puede probar Whady

- Oli pasa de reposo a escuchar, pensar y responder; respeta movimiento reducido.
- Hints rotativos que se detienen al escribir; sugerencias para iniciar tareas sin saber qué pedir.
- Consulta de internet de septiembre, comparación con octubre, presupuesto y explicación de estados.
- Alta de proveedor mediante formulario inline, revisión y confirmación explícita de un borrador local. Guardar no concede autoridad financiera.
- Adjuntar/arrastrar PDF/PNG/JPG, quitar archivos y validar hasta 4 archivos de 5MB. Solo se usan nombres/tamaños: no se leen contenidos ni se suben archivos.
- Filtrar las cinco facturas, abrir su explicación en la conversación o ir a la app actual. Botón clásico de carga siempre disponible.

## Alcance de producto

Esta es una propuesta interactiva con respuestas locales para recorridos concretos; no es un asistente LLM conectado. Todas las cifras están identificadas como ejemplo, no representan la D1 remota ni transferencias. No se conservan conversaciones o proveedores al recargar. Las credenciales nunca se usan en esta página.

La capa conversacional futura debería transformar intenciones en consultas y borradores de herramientas del backend, con respuestas basadas en hechos. Alta/activación y autorizaciones conservan la confirmación, roles, CSRF, idempotencia y revalidación existentes. El modelo no decide permisos; la conversación nunca debe aprobar un documento incierto.

Para integrar en React, Whady puede trasladar la composición y usar `<Oli state={state} dark={false} />`; cambiar el modelo local por las herramientas autorizadas será otro trabajo. El dataset de esta propuesta no debe importarse como métricas o seed del producto.

## Validación del 17 de octubre

Tres tests del modelo de ejemplo y adjuntos aprobados. Comprobados en Chrome sobre el dominio: consulta de internet y comparación, presupuesto, proveedor con confirmación, filtros y explicación del duplicado, selección real de un PDF, drag/drop, rechazo de formato y eliminación del adjunto. Pausa y movimiento reducido comprobados. Composición a 1440×1080 y 390×844 sin desbordamiento horizontal y con el campo visible. La API y la demo `/oli/` conservaron respuesta200. No se midió OCR ni se probaron conversaciones abiertas con un modelo: no forman parte de esta propuesta.
