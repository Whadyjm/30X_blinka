# Consolidación de main y limpieza de worktrees — 18 de octubre de 2026 UTC

## Resultado

Se consolidó el frontend ya publicado en `f44415c`, los fixtures manuales sintéticos y sus fuentes en `b46cb56`, y el informe de costos terminado en `8dc37b3`. Los catorce archivos del frontend/mascota coinciden byte a byte con las fuentes de la versión publicada `49399a66-3326-43a1-bbe3-484899ffd9cb`.

La limpieza no modifica API, dominio, contratos ni extracción respecto de `15c9bd9`, ni hace otro despliegue. No se ejecutan pagos reales ni se realizan llamadas de evaluación a modelos.

## Árboles y recuperación

Se retiraron once worktrees obsoletos: diez temporales y el del logo terminado. Se conserva `main` y el worktree `oli-video`, que sigue en uso. El trabajo concurrente en el informe de robustez se conserva y no se mezcla con el código de producto.

Antes de retirar cada árbol se verificaron sus parches, archivos sin commit, un archivo completo sin dependencias y su hash. También se verificó el bundle Git. Las ramas locales obsoletas se retiraron solo cuando su commit ya era recuperable desde una referencia remota. No se borraron ramas remotas de otros trabajos.

Los cambios históricos no integrados se preservan en estas ramas remotas; no deben fusionarse indiscriminadamente porque parten de versiones antiguas:

| Rama | Commit |
| --- | --- |
| `archive/cleanup-20261018/frontend-release-wip` | `5ab49b24562e` |
| `archive/cleanup-20261018/review-main-wip` | `9561055f4a36` |
| `archive/cleanup-20261018/logo-eyes-motion-wip` | `ddc8222c561c` |
| `archive/cleanup-20261018/video-work-in-progress` | `669fcd78c8c8` |
| `archive/cleanup-20261018/oli-candidate` | `2192757d5bf1` |

El snapshot del video contiene sus tres fuentes/documentos al momento del respaldo. El trabajo posterior y sus medios siguen en su árbol activo.

Respaldo local protegido, con manifiesto, bundles, archivos completos y logs de validación:

```text
/Users/oscarcrescente/Developer/archives/blinka-challenge/cleanup-20261018T021140Z
```

La carpeta duplicada de fixtures fue comparada por contenido y movida a `quarantine` en ese respaldo. Se versionó la carpeta canónica `fixtures/reto-manual-15-20261018` con sus quince documentos ficticios, controles y generador. Solo se normalizaron los saltos de línea del CSV, verificando que sus celdas no cambiaran.

Las capturas de revisión, exports del video y paquetes de entrega permanecen en disco y se excluyen de Git; la evidencia ya versionada en `docs/evaluations` se conserva.

## Validación

| Suite local | Pruebas aprobadas |
| --- | ---: |
| API | 150 |
| Dominio | 79 |
| Contratos | 29 |
| Extracción | 30 |
| D1 | 14 |
| Frontend | 59 |
| Mascota | 6 |
| Total | **367** |

Typecheck y build de producción web aprobados. La primera corrida web agotó el timeout de 5 segundos en una integración Miniflare mientras corrían otras suites y respaldos; al repetirla con `--testTimeout=30000`, pasaron sus 59 pruebas sin cambiar código ni configuración. Los logs de ambas corridas se conservan en el respaldo.

Estas comprobaciones cubren regresiones locales y contratos; no son métricas de exactitud del extractor ni una evaluación completa nueva de decisiones con modelos reales.
