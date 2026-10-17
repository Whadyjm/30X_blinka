# Extracción visual OpenRouter

Backend exclusivamente. `extractInvoiceWithOpenRouter()` recibe imágenes PNG/JPEG
(1–4, máximo conjunto 5 MiB), hash calculado por el servidor y clave privada.
Devuelve datos ajustados a `ExtractedInvoiceSchema`, modelo/proveedor real,
tokens/coste reportados e historial de intentos. Nunca devuelve una decisión.

Orden fijo:

1. `deepseek/deepseek-v4.1-flash`
2. `z-ai/glm-5.3-flash`
3. `minimax/minimax-m3`

Máximo tres llamadas: 12 segundos por intento, 40 segundos de límite global
y 2048 tokens de salida por llamada. El margen global permite que C tenga sus
12 segundos completos aunque A y B agoten los suyos; cada intento usa como máximo
el tiempo global restante.
Puede haber coste por intentos interrumpidos. No hay garantía de gasto exacto.

Fallback solo ante fallo de red, timeout, HTTP 404/408/429/5xx. Autenticación,
saldo insuficiente o request rechazado detienen la cadena. Una respuesta incierta
válida se conserva; JSON inválido, truncamiento o rechazo del modelo fallan
explícitamente. No se busca otra respuesta para conseguir una aprobación.
Si OpenRouter completo falla, los tres modelos pueden fallar juntos.

El adapter solicita JSON Schema estricto a rutas compatibles y valida otra vez
con Zod. Esto verifica estructura, no veracidad. Firma inicial del archivo y
tamaño no sustituyen un decodificador completo de imagen. PDF necesita renderizado
a imágenes y una corroboración separada antes de permitir autonomía financiera.
El hash debe provenir del servidor; esta función no autentica a su llamador.

```sh
pnpm --dir ../contracts install --frozen-lockfile
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
```

Las pruebas unitarias usan llamadas simuladas; no son una medición de OCR. La prueba privada
del Worker se describe en [apps/api](../../apps/api/README.md). Ver
[plan de robustez](../../docs/EXTRACTION_SAFETY.md) y
[resultado de la prueba real](../../docs/EXTRACTION_SMOKE.md).
La [evaluación de diez PNG](../../docs/EXTRACTION_EVALUATION.md) registra fallos,
abstenciones y discrepancias detectadas, más la regresión posterior separada.

Referencias: [model fallback](https://openrouter.ai/docs/guides/routing/model-fallbacks),
[selección de proveedores](https://openrouter.ai/docs/guides/routing/provider-selection),
[salida estructurada](https://openrouter.ai/docs/guides/features/structured-outputs).
