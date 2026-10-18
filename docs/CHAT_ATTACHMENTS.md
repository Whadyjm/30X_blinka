# Adjuntos del chat web

Hasta 10 archivos por mensaje, PDF/PNG/JPEG y máximo 5 MiB por archivo. `CHAT_MAX_ATTACHMENTS` en `@oli/contracts` comparte el límite entre selector/arrastre, envío y validación del servidor.

La carga y procesamiento conservan sus recibos y claves individuales. El envío rechaza más de diez antes de subir un archivo. Cada mensaje contiene solo IDs de facturas: el servidor verifica pertenencia a la empresa y conserva las garantías del motor. La respuesta admite diez tarjetas adjuntas más cuatro consultas; el límite de herramientas sigue en cuatro.

Al arrastrar archivos en Ask Oli aparece una zona sobre toda la pantalla: «SUELTA ACÁ tus documentos», formatos y límites. Desaparece al salir o soltar. Arrastrar texto no activa la zona. Un turno pendiente indica que debe terminar antes de recibir más documentos; el historial Telegram indica cambiar al chat web.

Los límites del ingreso por correo son independientes.
