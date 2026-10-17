# Prueba real de extracción y respaldo

Ejecutada el **16 de octubre de 2026, 22:47 Caracas** (17 de octubre, 02:47 UTC)
en `oli-api.tiamat-agency.workers.dev`, versión
`06a0311d-6387-4752-9f88-42865195a0f5`, mediante endpoint interno con token privado.
Solo se envió el PNG ficticio `fixtures/invoices/001.png`; no se enviaron políticas
ni respuestas de referencia al modelo. No se escribieron facturas/decisiones en D1.

| Intento | Resultado | Tiempo |
|---|---|---|
| DeepSeek V4.1 Flash | Error de proveedor 502 dentro de HTTP 200 | 3,7 s |
| GLM 5.3 Flash | Timeout | 12 s |
| MiniMax M3, proveedor Together | Extracción recibida y validada por Zod | 5,6 s |

Tiempo de la solicitud completa: **21,57 s**. Los ocho campos de referencia
coincidieron exactamente: proveedor, número, importe (5000 unidades menores),
moneda (USD), emisión, vencimiento, periodo y descripción. El hash del archivo
también coincidió con el calculado localmente. Health devolvió 200; la prueba sin
autorización devolvió 401.

MiniMax reportó 2920 tokens de entrada, 505 de salida y **USD 0,00142056**.
Eso corresponde a la respuesta final, **no al gasto total de la sesión ni a
posibles cargos de intentos fallidos o interrumpidos**.

El modelo añadió alertas por el carácter ficticio y la ausencia de datos bancarios
incluso después de precisar el prompt. No se eliminaron esas alertas. El resultado
quedó `verification: NOT_CHECKED`; no habilita aprobación automática. Falta calibrar
ese comportamiento sin ocultar dudas reales y obtener corroboración independiente.

Hubo solicitudes previas de diagnóstico sobre el mismo documento; permitieron
corregir la detección de errores incrustados en HTTP 200. Una prueba anterior
también llegó a MiniMax. **Repetir un solo documento no mide precisión sobre el
corpus, ni demuestra que A/B produzcan extracciones correctas**. Esta evidencia
valida la conexión, el respaldo hasta C y la respuesta segura a errores observados.

Repetición explícita con consumo de API: `pnpm --dir apps/api test:extraction:live`.
Requiere el token en el archivo ignorado descrito en [apps/api](../apps/api/README.md).
Pruebas locales: 14 del adapter y 7 del Worker, todas aprobadas, más typecheck
del adapter y empaquetado Wrangler. No equivalen a evaluación end-to-end del agente.
