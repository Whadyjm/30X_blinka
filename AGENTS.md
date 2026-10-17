# Proyecto Oli

- Fuente superior: `master_files/RETO_BLINKA.md`. Prevalece sobre el brief v3 y decisiones de implementación.
- Oscar mantiene backend/modelos/contrato API. Whady mantiene todo el frontend y consume `docs/API.md` y `packages/contracts`.
- El reto termina en decidir, registrar y explicar. Solo datos ficticios y autorizaciones simuladas; no ejecutar pagos reales.
- Prioridades: cero aprobaciones indebidas, autonomía correcta y explicabilidad. P1 nunca desplaza el núcleo del reto.
- Hermes y su VPS quedan fuera del MVP por decisión de Oscar. El Worker coordina el flujo con el modelo, D1 y R2; chat queda para después del MVP.
- Seguir `docs/EXTRACTION_SAFETY.md`: JSON válido no garantiza lectura correcta. Una extracción incierta no permite autoaprobar.
- Las citas/confianza del propio modelo no prueban exactitud. Hash, identidad y corroboración provienen del servidor.
- `checkExtraction()` solo compara datos; no ejecuta OCR, prueba procedencia ni decide aprobación. Falta integrar los adapters y el motor.
- `APPROVE` requiere comprobaciones de política vigente y reserva atómica. No repetir en JS la reserva que crean los triggers D1.
- Mantener historial append-only y separar procesamiento, decisión y revisión humana.
- Los tests de contrato y D1 no son métricas del extractor ni de decisiones end-to-end. No reportar resultados sin medirlos.
- Hay trabajo concurrente: revisar `git status` antes de editar/stagear; conservar cambios ajenos y publicar solo los propios.
