# Preparación del repositorio público

Revisión del 18 de octubre de 2026. GitHub ya mostraba `Whadyjm/30X_blinka` como público al comenzar esta limpieza.

Se retiraron del árbol 140 capturas y comprobaciones temporales de `.impeccable/review`, el ZIP generado de fixtures y el lockfile vacío de la raíz. El archivo descargable de Oli Skill se genera en `prebuild` y queda excluido de Git. Se conservaron sus fuentes, las facturas ficticias, los informes de evaluación y los videos de entrega.

Se sustituyeron rutas personales por rutas relativas y se omitió el correo de la cuenta de despliegue en metadatos. Los identificadores de recursos Cloudflare siguen en la configuración existente; no conceden acceso y cada instalación necesita recursos y secretos propios. Los archivos `.env` versionados de Vite contienen solo modos y opciones públicas; las credenciales permanecen en archivos locales ignorados o secretos del Worker.

## Evidencia e historial

El [manifest de saneamiento](evaluations/publication-sanitization-20261018.json) identifica el commit de origen y los hashes anteriores y posteriores. Los resultados, errores y decisiones medidos se conservan. Los hashes históricos que apuntan a informes saneados identifican los bytes originales de ese commit; no deben compararse con la copia saneada como si fueran los mismos bytes. Los hashes de documentos originales no cambian.

`fixtures/r2-manifest.json` se regeneró localmente. El recibo R2 sigue describiendo la copia remota histórica; esta limpieza no sincronizó ni sobrescribió objetos remotos. Las capturas auxiliares retiradas se conservaron en un respaldo local fuera del repositorio; las referencias a esas rutas en informes históricos son metadatos de aquellas corridas.

GitLeaks 8.30.1 revisó las referencias locales con `gitleaks git --log-opts='--all' --redact`: 120 commits inspeccionados y 112 alertas revisadas, correspondientes a 80 hashes SHA-256 y 32 identificadores de acuerdos ficticios. En la copia de los archivos versionados actuales aparecieron 84 alertas: 68 hashes y 16 identificadores ficticios. No se identificaron credenciales reales en esas alertas. El token local de extracción tampoco apareció en los 1.530 blobs alcanzables revisados por coincidencia exacta.

La revisión no rota credenciales ni comprueba si las locales coinciden con las del despliegue. El responsable del demo debe administrar su acceso por un canal privado. Las coincidencias de palabras comunes en código y documentación no se consideraron prueba de una filtración.

La limpieza del árbol no elimina metadatos ya presentes en commits anteriores ni en ramas remotas no descargadas. No se reescribió el historial. Los informes comerciales que estaban sin versionar al comenzar se conservaron sin cambios.

## Comprobaciones de esta limpieza

- Cuatro pruebas Python de fixtures/R2 aprobadas, con red simulada.
- Ocho pruebas de API de assets y Oli Skill aprobadas, con servicios locales/simulados.
- TypeScript y build de producción web aprobados; el paquete descargable se regeneró correctamente. Vite conserva su aviso de un chunk superior a 500 kB.
- Validación de JSON y `git diff --check` sin errores.

Estas comprobaciones no son una nueva medición OCR ni una evaluación de decisiones con modelos reales. No se ejecutaron pagos ni evaluaciones remotas.
