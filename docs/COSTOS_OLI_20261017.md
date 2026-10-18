# OLI: costo de operación y paso de demo a producto masivo

**Fecha de corte: 17 de octubre de 2026, Caracas. Moneda: USD, sin impuestos.** Consulta de precios: 17 de octubre, 22:10 de Caracas / 18 de octubre, 02:10 UTC.

## Resumen para guardar y presentar

**OLI funciona hoy para la demo del hackatón en el alcance evaluado.** Lee documentos, aplica las reglas de la empresa, autoriza de forma simulada, bloquea o escala, y registra la explicación. La candidata final tiene evidencia de **20/20 decisiones completas correctas y cero aprobaciones indebidas observadas** en veinte documentos ficticios. Esto respalda la demostración; todavía no acredita capacidad para atender público masivo. [Evidencia de la candidata](evaluations/FINAL_CANDIDATE_20261017.md).

**Presupuesto de referencia: USD 5/mes de infraestructura base, más consumo.** Para una demo con 100 documentos y 100 turnos de chat al mes, la proyección es **USD 5,86/mes**; con 1.000 documentos y 1.000 turnos, **USD 13,57/mes**. Reservar **USD 20–30/mes** es una provisión razonable para ese segundo escenario bajo los supuestos de este informe. No incluye trabajo del equipo, impuestos ni excedentes de infraestructura.

**Si OLI gana y se convierte en una función importante de Blinka, debe escalar como producto:** acceso por usuario y empresa, capacidad de lectura, colas, datos, controles de gasto y operación. El costo deja de depender de “tener el servidor prendido” y pasa a depender principalmente del volumen de documentos, conversaciones, retención y nivel de servicio.

Este documento estima el costo de correr OLI. **No es un estado de cuenta:** no se consultaron facturas, plan contratado ni consumo completo de las cuentas de Cloudflare/OpenRouter. La base de USD 5 corresponde al plan Workers Paid usado como referencia, no a un recibo verificado. [Tarifa oficial de Workers](https://developers.cloudflare.com/workers/platform/pricing/).

## 1. Qué estamos pagando

La implementación actual usa un Worker `oli-api`, frontend estático en ese mismo despliegue, una base D1, un bucket R2 y colas para facturas, correo y Telegram. Un cron recupera trabajos cada minuto. No hay Hermes ni VPS dentro del MVP. El alcance termina en decidir, registrar y explicar; no se mueve dinero. [Configuración](../apps/api/wrangler.jsonc), [fuente del reto](../master_files/RETO_BLINKA.md).

| Componente | Función actual | Costo de referencia |
| --- | --- | --- |
| Workers Paid | API, coordinación y cron | USD 5/mes por cuenta; incluye 10 millones de solicitudes y 30 millones de ms de CPU/mes |
| Frontend estático | Interfaz web | Solicitudes de assets gratuitas; las llamadas a la API consumen Worker |
| D1 | Empresas, reglas, decisiones, reservas simuladas e historial | Incluye 25.000 millones de filas leídas/mes, 50 millones escritas/mes y 5 GB en Paid |
| R2 Standard | Documentos originales privados | Franquicia de 10 GB-mes, 1 millón de operaciones A y 10 millones B/mes |
| Queues | Procesamiento asíncrono | Incluye 1 millón de operaciones/mes en Paid; un mensaje pequeño suele consumir tres |
| OpenRouter | Extracción, OCR independiente de imágenes y chat | Consumo por modelo/proveedor; comisión Standard de 5,5% al comprar créditos |
| Conversión PDF de Cloudflare | Segunda lectura del texto del PDF | Se presupuesta USD 0 para esta conversión de texto; no es OCR universal |
| Correo entrante y Telegram | Canales de entrada | Sin cargo de entrada de Email Routing ni uso de broadcasts pagados; sí consumen backend y modelos |

Fuentes: [Workers](https://developers.cloudflare.com/workers/platform/pricing/), [D1](https://developers.cloudflare.com/d1/platform/pricing/), [R2](https://developers.cloudflare.com/r2/pricing/), [Queues](https://developers.cloudflare.com/queues/platform/pricing/), [OpenRouter](https://openrouter.ai/pricing), [conversión Markdown](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/), [tratamiento PDF](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/how-it-works/), [correo](https://developers.cloudflare.com/email-service/platform/pricing/), [Telegram](https://core.telegram.org/bots/faq).

Las franquicias se comparten con los demás proyectos de la cuenta. Si ya se paga Workers Paid y sobra capacidad, el costo incremental de la base atribuible a OLI puede ser USD 0. Workers Free también existe, pero este informe presupuesta Paid como referencia de operación; no certifica que el despliegue actual use uno u otro plan.

### Excedentes que pueden aparecer

| Servicio | Tarifa adicional publicada |
| --- | --- |
| Worker | USD 0,30 por millón de solicitudes y USD 0,02 por millón de ms de CPU sobre lo incluido |
| D1 | USD 0,001 por millón de filas leídas; USD 1 por millón de filas escritas; USD 0,75/GB-mes sobre las franquicias |
| R2 Standard | USD 0,015/GB-mes; USD 4,50 por millón de operaciones A; USD 0,36 por millón B; salida a internet gratuita |
| Queues | USD 0,40 por millón de operaciones adicionales; reentregas y mensajes grandes aumentan operaciones |
| Logs de Workers | 20 millones de eventos/mes incluidos en Paid; USD 0,60 por millón adicional a esta fecha |

Las tarifas provienen de las páginas oficiales anteriores y de [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/). Cloudflare anuncia un cambio de precios de observabilidad para el **1 de diciembre de 2026**; este informe usa las tarifas vigentes en octubre. Esperar la respuesta de un modelo no equivale a consumir ese mismo tiempo de CPU del Worker.

## 2. Qué modelos usa OLI y cuánto cuestan hoy

Un PDF pasa por Gemini con el archivo original y una lectura separada del texto mediante Cloudflare. Una imagen pasa por un lector primario y una transcripción independiente de Qwen. El chat usa DeepSeek y puede requerir hasta tres rondas por turno. El motor de reglas y su explicación registrada se ejecutan en código: no necesitan otra llamada LLM para decidir. [Lectores](../packages/extraction/src/openrouter.ts), [corroboración](../apps/api/worker/document.js), [chat](../apps/api/worker/chat.js).

| Modelo configurado | Uso | Entrada USD / millón de tokens | Salida USD / millón de tokens |
| --- | --- | ---: | ---: |
| DeepSeek V4.1 Flash | Primario para imágenes y chat | 0,072 | 0,144 |
| GLM 5.3 Flash | Alternativa para imágenes | 0,048 | 0,200 |
| MiniMax M3 | Alternativa para imágenes | 0,300 | 1,200 |
| Gemini 3.8 Flash | Primario para PDF | 0,825 | 4,125 |
| Gemini 3.7 Flash | Alternativa para PDF | 0,750 | 3,750 |
| Gemini 3.1 Flash Lite | Alternativa para PDF | 0,250 | 1,500 |
| Qwen 3.8 Flash | Transcripción independiente PNG/JPEG | 0,150 | 0,470 |

Son precios publicados en el [catálogo público de OpenRouter](https://openrouter.ai/api/v1/models), capturado en [la base de cálculo](costs/oli-cost-basis-20261017.json). **El mínimo del catálogo no garantiza el precio de cada llamada:** cambian proveedor, disponibilidad, caché y ruta. La extracción ordena proveedores por precio; el chat no fija el más barato. Las imágenes y páginas también consumen entrada, y el razonamiento facturable puede aumentar la salida. El PDF nativo se cobra como entrada del modelo, sin añadir aquí un servicio Mistral OCR que OLI no está usando. [Procesamiento PDF oficial](https://openrouter.ai/docs/guides/overview/multimodal/pdfs).

## 3. Costo observado en la demo real

Se recalcularon los importes reportados por el proveedor en [la corrida real Ronda](evaluations/candidate-ronda-live-2026-10-17T23-57-09-830Z.json), iniciada el 17 de octubre. No se generaron nuevas llamadas de IA para preparar este informe.

| Lecturas nuevas | Documentos | Importe reportado total | Promedio por documento |
| --- | ---: | ---: | ---: |
| PDF: Gemini + conversión de texto separada | 10 | USD 0,0205425 | USD 0,00205425 |
| PNG/JPEG: primario + OCR Qwen | 9 | USD 0,0070226 | USD 0,00078029 |
| Total de lecturas nuevas | 19 | **USD 0,0275651** | **USD 0,00145079** |

En términos simples, las llamadas reportadas para esas diecinueve lecturas costaron **menos de tres centavos de dólar**, antes de comisión de recarga e infraestructura. La muestra es pequeña, de formatos conocidos y documentos cortos; no estima automáticamente facturas extensas o escaneos difíciles.

El vigésimo documento reutilizó ambas lecturas en caché. Sus USD 0,002088 guardados pertenecen a la lectura anterior y no se vuelven a sumar. Se contaron **28 respuestas con costo reportado: 19 primarias y 9 OCR**. Se sumó cada `attempts[].usage` una sola vez, sin volver a agregar su copia en `provenance.usage`. Se excluyó el control adicional `targetedP0`.

Estos importes son históricos: por ejemplo, los PDF de esta corrida reflejan una tarifa anterior a la captura actual del catálogo. Tampoco representan todo lo gastado durante el desarrollo. Faltan pruebas anteriores, eventuales llamadas interrumpidas no conciliadas, chat y consumo de Cloudflare. **El chat actual no conserva `usage` ni costo por ronda**, por lo que su costo unitario se estima a continuación, no se presenta como medido.

## 4. Proyección mensual para demo y piloto

Para presupuestar se usan importes superiores a los promedios observados, sin contar ahorros de caché:

| Unidad | Presupuesto de IA antes de margen y recarga |
| --- | ---: |
| Un PDF corto | USD 0,0030 |
| Una imagen, incluyendo sus dos lectores | USD 0,0015 |
| Un turno de chat completo | USD 0,0040 |

Un turno significa un mensaje del usuario con su respuesta y las rondas de herramientas necesarias. La hipótesis del chat es **8.000 tokens de entrada y 1.000 de salida sumados entre todas sus rondas**, usando una tarifa de referencia de USD 0,30/1,20 por millón: USD 0,0036, redondeado a USD 0,0040. Esta tarifa es un supuesto de presupuesto, no el mínimo de DeepSeek ni una ruta fijada. Un turno más largo puede costar más: 30.000 tokens de entrada y 6.000 de salida a esa tarifa serían USD 0,0162.

Se añade un **30% de contingencia de consumo** y un **5,5% para financiar la compra de créditos Standard**, además de la base Paid:

```text
Costo mensual estimado =
  5 + (PDF × 0,003 + imágenes × 0,0015 + turnos_chat × 0,004)
      × 1,30 × 1,055
    + excedentes de infraestructura
```

La comisión ocurre al recargar, no como un recargo individual de cada respuesta. Aquí se distribuye sobre el consumo presupuestado para estimar desembolso. Una recarga puede durar varios meses. [Condiciones de OpenRouter](https://openrouter.ai/pricing).

| Escenario mensual | Documentos, 50% PDF / 50% imágenes | Turnos de chat | Base + IA, margen y recarga | Provisión sugerida |
| --- | ---: | ---: | ---: | ---: |
| Demo | 100 | 100 | USD 5,86 | USD 10–15 |
| Piloto pequeño | 1.000 | 1.000 | USD 13,57 | USD 20–30 |
| Uso creciente | 10.000 | 10.000 | USD 90,72 | USD 120–150 |

Son escenarios de operación, no capacidades ya ensayadas. Suponen que Worker, D1, R2, colas y logs permanecen dentro de las franquicias; la provisión adicional tampoco garantiza cubrir cualquier exceso. Dominio, otros proyectos de la cuenta y retención acumulada pueden cambiar el total. Una factura adjuntada al chat consume lectura **y** conversación, ya incluidas si se cuentan ambas columnas.

## 5. Qué funciona hoy para la demo

La demo puede presentarse como **funcional y verificada dentro del alcance del hackatón**:

- La candidata final recorrió veinte documentos con lectores reales, HTTP, cola, D1 y R2; veinte decisiones completas correctas y cero aprobaciones indebidas observadas.
- Ocho de ocho casos normales se autorizaron automáticamente; quince de veinte tuvieron autonomía correcta. Hubo dos revisiones humanas simuladas y veinte decisiones con explicación.
- Se comprobaron replays sin una segunda reserva, acceso privado a originales e integridad de los documentos. La política vigente se vuelve a comprobar al autorizar.
- La interfaz y el recorrido de escritorio/móvil tienen evidencia guardada. El chat dispone de consultas y propuestas confirmables; no sustituye las garantías del motor.

Fuente y denominadores: [informe final](evaluations/FINAL_CANDIDATE_20261017.md) y [guion de entrega](ENTREGA_20261018.md). Estos resultados pertenecen a la candidata evaluada, no certifican automáticamente cambios posteriores. No se repitió la evaluación completa durante este trabajo de costos.

Además, durante la preparación del informe, `GET /api/health` respondió **HTTP 200, `ok: true`**. Este control consulta la API y ejecuta `SELECT 1` en D1; no comprueba disponibilidad de modelos ni repite el flujo completo. Su hora y respuesta se conservan en la base de cálculo.

“Funciona perfecto para la demo” debe entenderse en ese contexto. Se observaron errores técnicos en corridas anteriores; la muestra final no acredita extracción universal, disponibilidad garantizada ni carga masiva. **Veinte decisiones correctas tampoco significan veinte lecturas perfectas:** cuando hay incertidumbre, escalar es la decisión correcta. Todas las empresas y facturas de evaluación son ficticias, y las autorizaciones siguen siendo simuladas.

## 6. Qué debe escalar si gana y atiende público masivo

Ganar permitiría llevar OLI de una demo acotada a una función relevante del producto. **La arquitectura actual sirve como punto de partida; la preparación para público masivo requiere trabajo y medición propios.** No exige por sí sola añadir un VPS.

| Área | Situación comprobable hoy | Trabajo para una apertura masiva |
| --- | --- | --- |
| Acceso y empresas | Login ligado a `DEMO_USER_ID`, `DEMO_ORG_ID` y contraseña demo; ya hay roles y filtros por empresa | Integrar identidad real de Blinka, altas, invitaciones, revocación y permisos por empresa; validar aislamiento bajo concurrencia |
| Capacidad de lectura | Hasta dos consumidores simultáneos por cola; proveedores externos con cuotas propias | Medir tiempos y picos; ajustar concurrencia según RPM/tokens disponibles, repartir capacidad entre empresas y evitar que una bloquee al resto |
| Recuperación de trabajos | Reintentos acotados, leases, caché y barridos de hasta 100 trabajos por consulta cada minuto | Medir antigüedad y crecimiento del atraso, alertar fallos y dimensionar recuperación de picos; conservar idempotencia y límites de intentos |
| Base de datos | Una D1 para todas las empresas, con triggers de reserva atómica | Medir consultas, tamaño y contención; optimizar índices y lotes; particionar por empresa o grupos si los límites lo justifican |
| Interfaz y consultas | Hay consultas periódicas de historial Telegram cada cinco segundos | Medir consultas por usuario conectado; pausar en segundo plano o adoptar actualizaciones por eventos cuando se justifique |
| Gasto de IA | Se guarda uso de extracción; falta contabilidad por ronda del chat | Registrar tokens/costo/identificador por llamada; conciliar proveedor; definir cuotas y presupuesto global y por empresa antes de llamar modelos |
| Exactitud del lector | Muestra final pequeña, ficticia y de formatos soportados | Evaluar corpus representativo autorizado, escaneos, idiomas y formatos; medir errores críticos y autonomía por segmento; mantener abstención ante incertidumbre |
| Operación | Logs habilitados y trazas muestreadas al 1% | Definir objetivos de servicio, alertas, guardia, restauración ensayada y despliegues graduales con reversión |
| Datos y documentos | Originales privados en R2; historial y artefactos en D1 | Definir retención, archivo y acceso para datos autorizados de clientes; dimensionar almacenamiento sin perder el historial de decisiones requerido |

Referencias de implementación: [acceso](../apps/api/worker/auth.js), [trabajos](../apps/api/worker/jobs.js), [configuración](../apps/api/wrangler.jsonc), [chat](../apps/api/worker/chat.js), [consultas periódicas](../apps/web/src/features/chat/useConversation.ts).

Cloudflare documenta **10 GB máximos por base D1 y consultas ejecutadas de una en una dentro de cada base**; por eso “el Worker escala” no demuestra que una única base soporte cualquier carga. Las réplicas pueden ayudar con lecturas, pero no multiplican por sí solas la capacidad de reservar presupuesto. Si se particiona, el estado de autorización de una empresa debe mantener una frontera transaccional que preserve la reserva atómica y las comprobaciones de política. [Límites D1](https://developers.cloudflare.com/d1/platform/limits/), [réplicas de lectura](https://developers.cloudflare.com/d1/best-practices/read-replication/).

### Cómo cambia el presupuesto a volumen masivo

Extrapolación del mismo supuesto de documentos cortos y un turno de chat por documento:

| Volumen mensual | IA con contingencia y recarga | Qué falta sumar |
| --- | ---: | --- |
| 100.000 documentos + 100.000 turnos | USD 857,19 | Base, excedentes de infraestructura, identidad y operación |
| 1.000.000 de documentos + 1.000.000 de turnos | USD 8.571,88 | Base, excedentes de infraestructura, identidad y operación |

**Estas cifras son proyecciones de gasto de IA, no cotizaciones de un servicio masivo ni pruebas de capacidad.** Si el público conversa diez veces por cada documento, se pagan diez veces los turnos, aunque el número de facturas no cambie. El precio elegido por proveedor y la longitud del contexto pueden mover más el costo que el hosting.

La retención también se acumula: con documentos de 0,5 MB, un millón de documentos mensuales y doce meses conservados suman aproximadamente 6 TB de originales. A tarifa Standard, ese volumen representaría alrededor de **USD 90/mes de almacenamiento R2**, antes de operaciones, artefactos y otros datos; es un ejemplo de volumen completo retenido, no la factura del primer mes. D1 puede crecer antes por guardar JSON, texto e historial. [Tarifas R2](https://developers.cloudflare.com/r2/pricing/).

Antes de abrir al público: integrar identidad y permisos, completar medición de costos, limitar consumo por empresa, hacer pruebas de carga y fallos con presupuestos concurrentes, y ampliar gradualmente el acceso. La salida de una etapa a la siguiente debe depender de latencia, atraso de cola, errores, costo unitario y decisiones correctas medidos. **Ningún ajuste de capacidad debe relajar la política vigente, la reserva atómica, la confirmación humana requerida o la abstención ante una lectura incierta.**

## 7. Alcance y trazabilidad del informe

Se revisaron código/configuración local, evidencia previa y tarifas oficiales. Se guardaron precios del catálogo, hashes de fuentes, llamadas observadas sin documentos ni credenciales, exclusión de caché y fórmula en [oli-cost-basis-20261017.json](costs/oli-cost-basis-20261017.json).

No se midieron tráfico mensual real, CPU, filas/operaciones facturadas, ocupación actual, saldo OpenRouter, costo acumulado del desarrollo ni capacidad máxima. Tampoco se cotizaron personal, soporte, identidad de producción, dominio, impuestos o integraciones futuras. El costo de procesar documentos debe distinguirse del costo humano de revisar casos escalados. Estos rubros deben presupuestarse para operar el producto, aunque no sean necesarios para demostrar el reto.
