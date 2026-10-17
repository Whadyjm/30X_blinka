# Onboarding de Oli para Whady

Responsable: Whady · Superficie: frontend web · Prioridad: núcleo del producto.

Tarea asignada: [GitHub #3](https://github.com/Whadyjm/30X_blinka/issues/3).

Llevar al usuario desde conocer a Oli hasta ver su primera factura revisada, entendiendo qué puede aprobar por su cuenta, cuándo necesita autorización y por qué toma cada decisión. El recorrido debe sentirse como preparar a un empleado para trabajar contigo.

## Dirección acordada

**Bienvenida → reglas generales → un proveedor y su acuerdo → revisar y activar → primera factura.**

La empresa viene de la sesión. No pedir registro de empresa, datos legales, nombre del responsable ni conexiones bancarias en este recorrido. No exigir cargar todo el directorio de proveedores ni crear límites individuales antes de empezar.

**Criterio explícito de Oscar:** no mostrar avisos, banners, badges, tooltips ni textos de “demo”, “datos ficticios”, “simulación” o “no se mueve dinero”. Eliminar ese copy heredado de las superficies que componen este recorrido, incluido `DemoBanner`. Los textos hablan de Oli, tus reglas y tus facturas. Los estados operativos y las explicaciones de una decisión sí deben seguir visibles.

Mantener la identidad visual de la app y reutilizar la mascota aprobada. No construir un carrusel de features previo a la configuración.

## 1. Bienvenida

Oli es el protagonista y mira hacia el mensaje al aparecer.

> **¡Hola! Soy Oli, tu empleado financiero.**
>
> Reviso tus facturas, apruebo las que cumplen tus reglas y te consulto cuando necesito tu autorización.
>
> Vamos a definir cómo trabajaremos juntos.

CTA principal: **Vamos a empezar**.

Una sola pantalla de presentación. Texto y botón disponibles desde el inicio; ninguna animación obliga a esperar. Se puede saltar la presentación e ir a las reglas, sin saltarse su confirmación.

## 2. Mis reglas de trabajo

Título: **¿Qué puedo resolver por ti?**

Explicación: “Define cuánto puedo aprobar solo y cuándo debo consultarte”. Mostrar tres importes con moneda explícita:

| Campo | Valor inicial si no hay configuración | Ayuda breve |
| --- | --- | --- |
| Puedo aprobar sin consultarte hasta | USD 300 por factura | Siempre que la factura cumpla las demás reglas. |
| Importe máximo por factura | USD 1.000 | Por encima de este importe, la factura queda bloqueada. |
| Presupuesto mensual | USD 2.000 | Las aprobaciones reservan parte de este presupuesto. |

Estos valores son una propuesta editable, no una autorización implícita. Priorizar siempre el borrador guardado o la configuración vigente sobre los valores iniciales.

Oli resume los valores elegidos en lenguaje natural. Ejemplo:

> “Puedo aprobar hasta USD 300 por factura si todo está en orden. Por encima te pediré autorización, hasta un máximo de USD 1.000. El presupuesto del mes es USD 2.000”.

En la configuración inicial, usar el mismo importe para el límite automático y el umbral de revisión humana. Mantener proveedor autorizado y acuerdo activo obligatorios, revisión humana habilitada y sin programación ni delegaciones. El resumen final debe comunicar esas condiciones. No exponer todos los toggles del formulario avanzado en esta pantalla.

Si una configuración existente tiene un umbral de revisión más bajo, conservarlo y mostrarlo: no subirlo silenciosamente para simplificar el formulario. La explicación siempre debe corresponder a los valores efectivos.

CTA: **Continuar**. Errores al lado del campo, conservando lo escrito.

## 3. Mi primer proveedor

Título: **¿Con quién voy a trabajar?**

Explicación: “Necesito saber a quién autorizas y qué has acordado con ese proveedor”.

Presentar un único proveedor con su acuerdo en una tarjeta compacta. Si ya existen proveedores, permitir elegir uno y mostrar sus datos sin crear registros nuevos. Para una configuración vacía, ofrecer una plantilla editable y el alta manual en el mismo paso.

La tarjeta incluye nombre, autorización, concepto, moneda, importe acordado, frecuencia y tolerancia. Como referencia visual, un acuerdo de hosting de USD 200 al mes y tolerancia cero. El nombre y los términos usados al procesar deben corresponder a los registros guardados, no a un nombre de presentación inventado.

CTA: **Confirmar proveedor y acuerdo**.

No deducir autorización, frecuencia o tolerancia a partir de una factura. Confirmar este paso registra o selecciona proveedor/acuerdo; todavía no activa el mandato ni aprueba facturas. Mostrar el estado guardado al volver a este paso para evitar altas duplicadas.

El directorio completo se gestiona después. El alta guiada desde una factura de proveedor nuevo sigue el handoff conversacional existente y no es un requisito adicional para terminar este onboarding.

## 4. Revisar y activar

Título: **Así voy a trabajar contigo**.

Mostrar un resumen breve con límite automático, umbral humano efectivo, máximo por factura, presupuesto mensual, moneda, proveedor y términos del acuerdo. Incluir las condiciones de proveedor autorizado y coincidencia con el acuerdo.

Oli explica:

> “Si encuentro un duplicado, falta presupuesto o no puedo verificar una factura, no la aprobaré automáticamente”.

Permitir editar cada sección conservando los demás datos. El resumen debe representar exactamente el borrador que se va a activar.

CTA explícito: **Activar estas reglas**. No activar al avanzar de paso ni por una respuesta del chat. Mostrar éxito después de la confirmación del servidor.

Si los datos cambian mientras se revisan, recargar el resumen y pedir que se confirme la versión actual. Conservar el borrador ante errores de red.

## 5. Primera factura

Tras activar, ir directamente a **Revisemos tu primera factura**.

Acciones: **Elegir factura** y **Usar factura preparada**. La factura preparada debe coincidir con el proveedor y acuerdo elegidos; si el usuario los cambió y ya no coincide, mantener el resultado que corresponda, sin ajustar reglas para forzar aprobación. No mostrar una plantilla incompatible como si perteneciera al proveedor elegido.

Usar el pipeline real de subida, procesamiento y consulta. Mientras espera, Oli acompaña con “Estoy revisando tu factura”. No simular avances, respuestas ni un resultado favorable.

La tarjeta final presenta proveedor, importe y moneda, decisión del servidor, explicación legible, acceso al detalle y presupuesto reservado/disponible actualizado cuando corresponda.

| Decisión | Presentación |
| --- | --- |
| APPROVE | **Aprobada** y motivo confirmado. |
| ESCALATE | **Necesita tu revisión**, motivo y acción de revisión si el servidor la permite. |
| BLOCK | **Bloqueada**, motivo y siguiente paso permitido. |
| FAILED | Explicar el fallo técnico y ofrecer el reintento permitido. No presentarlo como decisión. |

El valor es comprender la decisión. Una lectura incierta o un duplicado no se convierten en aprobación para cerrar el recorrido.

CTA final: **Ver mis facturas**. Los casos adicionales de autorización humana y duplicado pueden probarse desde el flujo habitual; no añadir otro tour obligatorio.

## Presencia y movimiento de Oli

- Mantener a Oli visible en cada paso sin tapar el contenido ni los controles; adaptar tamaño y posición a móvil.
- Reutilizar la esfera de partículas, ojos ovalados sin pupilas, cejas y ausencia de boca. No redibujar al personaje.
- Al aparecer un bloque, dirigir su mirada hacia el texto. Al enfocar un campo, mirar hacia el campo. Actualizar el objetivo al cambiar el layout, sin mover el foco del teclado.
- Usar `listening` durante la interacción, `thinking` durante una espera real, `understanding` al mostrar una explicación y una reacción breve de `happy` tras guardar o activar correctamente. La expresión no sustituye el estado escrito.
- La mirada debe apuntar al elemento activo en cada viewport, no seguir continuamente al cursor. Sin controles de play/pausa.
- Respetar `prefers-reduced-motion`; mantener texto y acciones disponibles y evitar desplazamientos de layout durante las transiciones.

## Integración y alcance técnico

Fuente superior: `master_files/RETO_BLINKA.md`. Contrato: `docs/API.md` y `packages/contracts`. Oscar mantiene API/modelos; Whady implementa el frontend.

Reutilizar `Onboarding.tsx`, formularios/resúmenes y hooks existentes, manteniendo el alcance del cambio en este flujo y su primera factura. No rediseñar dashboard, Rules ni el resto de la aplicación.

| Necesidad | Contrato o pieza existente |
| --- | --- |
| Empresa, rol y configuración | Sesión, `/me`, `GET /mandate` |
| Guardar propuesta | `PUT /mandate/draft` |
| Proveedor y acuerdo | `/vendors`, `/agreements` |
| Activación explícita | `POST /mandate/activate` con revisión y versión esperadas |
| Primera factura | `POST /invoices`, `POST /invoices/:id/process`, consulta de estado/detalle |
| Resultado y presupuesto | `latestDecision`, solicitud de revisión y `/budgets` |
| Mascota | `packages/oli` |

La API Canvas de la mascota ya ofrece `lookAt`; el wrapper React actual no expone ese control. Añadir el puente mínimo y reutilizable necesario para apuntar a texto/campos, coordinando cambios en el paquete compartido y preservando su comportamiento actual.

Importes en unidades menores al llamar a la API. Conservar CSRF, claves de idempotencia, validación, errores y permisos existentes. La UI muestra la decisión confirmada por el servidor; no calcula aprobaciones ni reservas a partir de importes o animaciones.

La política activa sigue siendo la fuente de verdad al regresar. Permitir abrir de nuevo la presentación desde una acción secundaria como **Conocer a Oli**. Recorrerla con una configuración existente no borra datos ni crea otra versión si no hubo cambios. Si se editan reglas, usar borrador y activación explícita de una nueva versión. Un APPROVER puede explorar las funciones permitidas, sin recibir controles de configuración reservados al OWNER.

Para probar una configuración inicial, usar una base local aislada con empresa/usuario provisionados y sin política activa. El seed habitual ya trae una política activa: no borrarla ni reiniciar la base compartida para mostrar el onboarding.

Algunos registros actuales contienen etiquetas de demo en sus nombres. Coordinar con Oscar datos de arranque con nombres limpios y archivos consistentes; no recortar identidades en el frontend, inventar DTOs ni modificar comprobaciones para resolver ese detalle de copy.

## Tarea de implementación

- [ ] Sustituir la bienvenida/formulario de empresa por la presentación de Oli y retirar los avisos de demo del recorrido.
- [ ] Simplificar el mandato a las tres preguntas, con resumen fiel a todos los valores efectivos y valores existentes preservados.
- [ ] Construir la selección/alta compacta de un proveedor y su acuerdo, sin cargar obligatoriamente un directorio completo ni repetir altas.
- [ ] Integrar resumen editable y activación explícita con la API existente.
- [ ] Conectar inmediatamente la primera factura, incluida la preparada, al procesamiento y detalle existentes.
- [ ] Integrar a Oli en cada paso y dirigir su mirada al texto/campo activo, con movimiento reducido y navegación por teclado.
- [ ] Resolver recorrido inicial, vuelta atrás, borrador recuperado y recorrido con política ya activa sin reiniciar datos.
- [ ] Verificar móvil y desktop, estados de carga/error y resultados APPROVE/ESCALATE/BLOCK sin cambiar decisiones para mejorar la presentación.
- [ ] Entregar PR con capturas o grabación del flujo y validaciones realizadas; comunicar a Oscar cualquier dato/acción faltante en el contrato.

## Criterios de aceptación

1. Una persona llega a la primera factura pasando por bienvenida, reglas, proveedor y confirmación explícita, sin registrar la empresa.
2. No hay banners ni textos de demo, datos ficticios o avisos equivalentes en las superficies del recorrido.
3. Se entiende la diferencia entre autonomía por factura, máximo absoluto y presupuesto mensual. La explicación respeta cualquier umbral humano existente.
4. La regla efectiva requiere proveedor autorizado y acuerdo coincidente; guardar un proveedor no equivale a aprobar su factura.
5. La activación corresponde al resumen revisado; reintentos o doble clic no repiten efectos.
6. La primera factura muestra el resultado confirmado, su motivo y acceso al detalle. Una incertidumbre nunca se presenta como aprobación.
7. Oli mira al texto/campo correcto en móvil y desktop, sin bloquear lectura, botones o teclado; el recorrido funciona con movimiento reducido.
8. Volver atrás, recargar o regresar con una política activa conserva los datos y no activa cambios sin confirmación.
9. Corren `npm --prefix apps/web run typecheck`, `npm --prefix apps/web test` y `npm --prefix apps/web run build`; si cambia la mascota, también `node --test packages/oli/test/*.test.js`. Añadir cobertura de comportamiento solo donde cambie la lógica del flujo.
10. Revisar el recorrido con una primera factura válida, una que necesita autorización, un duplicado y un fallo de procesamiento. Registrar resultados observados; no reportar precisión ni tiempos sin medirlos.

## Referencias

- [Reto Blinka](../master_files/RETO_BLINKA.md)
- [Contrato API](API.md)
- [Integración del frontend](FRONTEND_HANDOFF.md)
- [Alta contextual desde factura](CONVERSATION_FRONTEND_HANDOFF.md)
- [Mascota Oli](../packages/oli/README.md)
- [Onboarding actual](../apps/web/src/pages/Onboarding.tsx)
