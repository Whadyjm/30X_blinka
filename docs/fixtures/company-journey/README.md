# Recorridos de tres empresas ficticias

Lumen Studio Demo LLC, Brisa Services Demo LLC y Cedro Logistics Demo LLC tienen veinte documentos cada una. Sus mandatos, proveedores y acuerdos son ficticios. Cada empresa procesa sus documentos en orden sobre un presupuesto acumulado, sin restablecer el saldo entre casos.

Los manifiestos fijan archivos, hashes, campos y resultados esperados antes de las lecturas reales. Los documentos normales utilizan etiquetas explícitas soportadas por el lector separado; cambian importes, proveedores, conceptos y disposición visual. Esta prueba mide el recorrido con nuevos documentos dentro de ese alcance, no precisión universal ante formatos arbitrarios.

## Ejecutar

Desde la raíz del repositorio:

```sh
node apps/api/scripts/evaluate-company-journey.mjs --validate --company=lumen
node apps/api/scripts/evaluate-company-journey.mjs --self-test --company=lumen
node apps/api/scripts/evaluate-company-journey.mjs --run --company=lumen
```

Cambiar `lumen` por `brisa` o `cedro`. `--validate` no invoca modelos. `--self-test` usa lecturas sintéticas explícitas para comprobar el guion y la infraestructura local; sus resultados no son métricas de extracción. `--run` realiza lecturas remotas pagadas y genera un reporte nuevo, conservando los fallos.

La credencial del probe se lee internamente de `.env.extraction-probe`, ignorado por Git. Nunca se incluye en parámetros ni reportes. El lector recibe bytes y MIME, sin políticas, acuerdos ni respuestas esperadas. Cada empresa hace como máximo veinte solicitudes al probe, sin reintentos externos; una copia binaria puede reutilizar una lectura dentro de esa empresa.

## Alcance del recorrido

El runner crea una organización y su propietario en D1 local. Usa la API original para iniciar sesión, guardar y activar el mandato, crear proveedores y acuerdos, subir archivos, consultar el procesamiento, revisar excepciones y cerrar sesión. D1 y R2 se ejecutan con Miniflare y conservan estado aislado por corrida.

La creación durable del trabajo, el consumidor, el motor y los triggers financieros son los del producto. El transporte de mensajes es una cola controlada en memoria; se prueban entregas concurrentes e idempotencia. La lectura remota usa el endpoint privado existente con los lectores reales. No se escribe información financiera en producción y no se prueba navegador ni transporte remoto de Cloudflare Queues.

Las decisiones humanas son acciones explícitas simuladas por el runner. La excepción aprobable también comprueba que activar otra versión del mandato invalida la autorización anterior, antes de reevaluar y confirmar con la versión vigente.

Los reportes `docs/evaluations/company-journey-<empresa>-<fecha>.json` conservan lecturas, discrepancias, decisiones, reservas, tiempos y replays. Los que contienen `selftest` son pruebas sintéticas separadas. Los fallos de preparación anteriores a las llamadas reales se conservan como evidencia de la validación del guion.
