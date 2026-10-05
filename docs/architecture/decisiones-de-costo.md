# Decisiones de costo para el día 1

Estas son las tres decisiones de arranque que propuso el equipo de producto, tal como se escribieron, y cómo quedaron en el diseño. El detalle técnico de cada una está en [backend-design.md](./backend-design.md).

---

## 1. Almacenamiento de tickets y CFDIs: Cloudflare R2 en lugar de AWS S3

> Guardar fotos de tickets, PDFs y XMLs en **Cloudflare R2** en lugar de S3 estándar te da compatibilidad S3 idéntica pero con **$0 costo de transferencia de datos de salida (egress fees)**.

**Estado: adoptada.**

- Fotos de tickets, XML y PDF van a R2, con la misma API que S3 (el adaptador usa el SDK de S3 apuntando al endpoint de R2), así que cambiar de proveedor sería cambiar configuración, no código.
- El bucket es privado. La app y el bot entregan cada archivo con una URL firmada de vida corta, nunca con un enlace público.
- Cloudflare Email Routing recibe los correos con CFDI que mandan los portales de los comercios y los deja directamente en R2, también sin costo.
- Llaves de objeto por tenant (`accounts/<account_id>/receipts/<receipt_id>.jpg`), para poder borrar o exportar todo lo de un cliente.

## 2. Motor de base de datos y pooling

> PostgreSQL utilizando un esquema multi-tenant relacional con identificador `organization_id` / `tenant_id` en todas las tablas transaccionales. Configura pooling nativo desde el ORM para no saturar instancias pequeñas de base de datos.

**Estado: adoptada, con un refuerzo.**

- El identificador de tenant se llama `account_id` (la cuenta es el tenant: personal o de organización) y está en todas las tablas de datos de cliente.
- **Refuerzo**: además de filtrar en el código, PostgreSQL aplica Row-Level Security. La API se conecta con un rol sin privilegios de dueño y cada transacción declara su tenant; si el código olvida un filtro, la base de datos no devuelve filas de otro cliente. Está probado en `test/tenant-isolation.e2e-spec.ts`.
- **Pooling**: pool de `node-postgres` de 10 conexiones por instancia (configurable) y, en producción, el *pooler* del proveedor (PgBouncer en modo transacción) delante de la base. El contexto de tenant dura una sola transacción, así que es compatible con ese modo.
- Timeouts de sentencia (10 s) y de transacción inactiva (15 s) para que una consulta lenta no tumbe una instancia pequeña.

## 3. Pipeline asíncrono para tickets

> Procesar OCR y timbrado ante PACs toma entre 3 y 15 segundos. Diseña el backend para responder inmediatamente `200 OK` al webhook de WhatsApp y delegar el procesamiento a una cola ligera (como BullMQ respaldada por Redis), evitando que las conexiones HTTP del servidor se queden abiertas consumiendo memoria.

**Estado: adoptada en el principio; cambia la herramienta de cola.**

- **Se mantiene**: el webhook valida la firma de Meta, guarda lo mínimo, encola y responde `200` en milisegundos. Todo lo demás (descarga de la imagen, OCR, portal del comercio, validación ante el SAT, respuesta por WhatsApp) corre en workers.
- **Precisión sobre el timbrado**: Ticbo no timbra ante un PAC. El CFDI lo emite el comercio cuando Ticbo llena su portal de facturación. Ese paso (abrir el portal con un navegador automatizado, llenar el formulario y esperar el correo con el XML) tarda de segundos a varios minutos, no de 3 a 15 segundos. Eso refuerza la necesidad de la cola.
- **Cambio**: en lugar de BullMQ con Redis, la cola vive en el mismo PostgreSQL con **pg-boss**:
  - Ahorra una instancia de Redis siempre encendida. BullMQ en Redis serverless cobra por comando y consume muchos.
  - El ticket y su trabajo se guardan en la misma transacción: no puede quedar un ticket sin procesar ni un trabajo huérfano.
  - Aguanta cientos de trabajos por segundo; el plan más grande son 2,000 facturas al mes.
  - La cola está detrás de una interfaz: si algún día se superan unos 50 trabajos por segundo sostenidos, se cambia a BullMQ, SQS o Cloudflare Queues sin tocar la lógica de negocio.
