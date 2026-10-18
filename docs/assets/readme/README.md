# Imágenes del README

Las cinco capturas de interfaz se tomaron de la aplicación publicada el 18 de octubre de 2026, con datos de empresas ficticias. Muestran el dashboard, las reglas activas, una factura autorizada por una persona y la bienvenida de conversación en escritorio y móvil. Los importes y estados corresponden a ese momento; no se presentan como una nueva evaluación.

La navegación fue de consulta. Solo se abrieron y revocaron sesiones de acceso; no se subieron facturas, enviaron mensajes, modificaron políticas ni solicitaron llamadas a modelos. «Nueva conversación» abre un estado local vacío y no registra un mensaje. Ambas sesiones se revocaron al terminar.

Las portadas de escritorio y móvil y `oli-expresiones.png` se renderizaron desde [cover.html](cover.html), que utiliza el [renderer de Oli](../../../packages/oli/src/renderer.js) y la fuente Inter ya incluida en el proyecto. Las imágenes conservan la mascota existente: cuerpo de partículas, ojos y cejas, sin boca. La composición usa un recorte fijo para el lienzo, sin controles interactivos. No se modificó el código de la aplicación.

Para previsualizar la composición, sirve la raíz del repositorio con un servidor HTTP local y abre `/docs/assets/readme/cover.html`; añade `?expressions` para la tira de expresiones o `?mobile` para la portada móvil. La portada mide 1440 × 560 px; la variante móvil, 720 × 840 px; la tira, 1440 × 350 px. El navegador debe cargar la fuente antes de capturar.

El [manifest](manifest.json) registra rutas, dimensiones, tamaños y SHA-256 de las ocho imágenes. Las capturas tienen texto alternativo en el README principal. No contienen contraseñas, cookies ni tokens de acceso.
