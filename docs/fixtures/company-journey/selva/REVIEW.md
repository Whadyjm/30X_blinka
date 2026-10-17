# Selva: muestra congelada antes de lectores

20 documentos ficticios en una empresa nueva: ocho facturas normales, dos revisiones humanas, dos duplicados y ocho casos de control. Incluye PDF, PNG y JPEG, encabezados del cliente o del proveedor, valores en líneas separadas y una imagen girada. Reutiliza las familias de formatos etiquetados soportadas; no mide la variedad completa de documentos del mundo real.

Los documentos tienen nuevas identidades, conceptos, importes y fechas respecto de Marena. El techo es USD 1.500 y el presupuesto USD 1.800. Las ocho facturas normales reservan USD 805; una aprobación humana adicional reserva USD 280. La factura de USD 1.200 supera el saldo disponible incluso si una factura normal se abstiene y falla la aprobación humana anterior. Así, ese control no depende de que todas las lecturas previas tengan éxito.

El manifest, los bytes y sus resultados esperados se fijaron antes de la primera llamada real. El self-test verifica el recorrido con lecturas sintéticas y no acredita OCR. El runner real usa únicamente los bytes originales para los lectores y mantiene reglas, acuerdos y expectativas fuera de su entrada. Conserva errores técnicos y lecturas inciertas, sin reintentos externos para buscar mejores resultados.

El PDF en `targeted/` es un control adicional del duplicado con antecedente sin proveedor resuelto. Se declaró antes de ejecutar y queda fuera del denominador de veinte. Debe escalar sin excepción humana ni reserva.

Objetivos: cero aprobaciones indebidas observadas, al menos 19/20 decisiones completas correctas, al menos 7/8 normales automáticas con datos correctos, 20/20 explicaciones. Los resultados y la identidad publicada están en `docs/evaluations`; este archivo describe el diseño, no anticipa resultados.
