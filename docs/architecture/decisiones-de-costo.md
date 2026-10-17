# Decisiones de costo para el día 1

Estas son las tres decisiones de arranque que propuso el equipo de producto, tal como se escribieron, y cómo quedaron en el diseño. El detalle técnico de cada una está en [backend-design.md](./backend-design.md).

---

## 1. Almacenamiento de tickets y CFDIs: Cloudflare R2 en lugar de AWS S3

> Guardar fotos de tickets, PDFs y XMLs en **Cloudflare R2** en lugar de S3 estándar te da compatibilidad S3 idéntica pero con **$0 costo de transferencia de datos de salida (egress fees)**.

**Estado: cambiada a S3 (octubre 2026).**

- Todo lo demás vive en AWS. Un bucket de S3 en la misma cuenta (`ticbo-files-*`, en `infra/bootstrap.yaml`) se alcanza con el rol de la Lambda: no hay llaves de otro proveedor que guardar, rotar o filtrar, y los permisos quedan en las mismas plantillas que el resto.
- El ahorro de R2 está en la salida de datos. Hoy una foto sale solo cuando alguien la abre en el panel, y AWS incluye 100 GB de salida gratis al mes: en esta etapa no hay costo que ahorrar.
- El adaptador habla la API de S3 firmada con SigV4, así que mudarse a R2 si la salida crece sería configuración, no código.
- Se mantiene lo demás: bucket privado, nada público, y llaves de objeto por tenant (`accounts/<account_id>/receipts/<receipt_id>.jpg`) para poder borrar o exportar todo lo de un cliente.

## 2. Motor de base de datos y pooling

> PostgreSQL utilizando un esquema multi-tenant relacional con identificador `organization_id` / `tenant_id` en todas las tablas transaccionales. Configura pooling nativo desde el ORM para no saturar instancias pequeñas de base de datos.

**Estado: adoptada, con un refuerzo.**

- El identificador de tenant se llama `account_id` (la cuenta es el tenant: personal o de organización) y está en todas las tablas de datos de cliente.
- **Refuerzo**: además de filtrar en el código, PostgreSQL aplica Row-Level Security. La API se conecta con un rol sin privilegios de dueño y cada transacción declara su tenant; si el código olvida un filtro, la base de datos no devuelve filas de otro cliente. Está probado en `test/tenant-isolation.e2e-spec.ts`.
- **Proveedor**: Supabase, usado solo como PostgreSQL. Su API pública de datos queda cerrada (migración `0002`).
- **Pooling**: como el cómputo corre en Lambda, cada instancia abre **una** conexión (`DATABASE_POOL_MAX=1`) contra el *transaction pooler* de Supabase (Supavisor), que es quien multiplexa. El pool del ORM solo no basta en serverless: cientos de instancias con 10 conexiones cada una agotarían la base. El contexto de tenant dura una sola transacción, así que es compatible con ese modo.
- Timeouts de sentencia (10 s) y de transacción inactiva (15 s) en el rol de la API, para que una consulta lenta no tumbe una instancia pequeña.

## 3. Pipeline asíncrono para tickets

> Procesar OCR y timbrado ante PACs toma entre 3 y 15 segundos. Diseña el backend para responder inmediatamente `200 OK` al webhook de WhatsApp y delegar el procesamiento a una cola ligera (como BullMQ respaldada por Redis), evitando que las conexiones HTTP del servidor se queden abiertas consumiendo memoria.

**Estado: adoptada en el principio; cambia la herramienta de cola.**

- **Se mantiene**: el webhook valida la firma de Meta, guarda lo mínimo, encola y responde `200` en milisegundos. Todo lo demás (descarga de la imagen, OCR, portal del comercio, validación ante el SAT, respuesta por WhatsApp) corre en funciones asíncronas.
- **Precisión sobre el timbrado**: Ticbo no timbra ante un PAC. El CFDI lo emite el comercio cuando Ticbo llena su portal de facturación. Ese paso (abrir el portal con un navegador automatizado, llenar el formulario y esperar el correo con el XML) tarda de segundos a varios minutos, no de 3 a 15 segundos. Eso refuerza la necesidad de la cola.
- **Cambio**: el backend corre en **AWS Lambda con pago por uso**, así que la cola es **Amazon SQS** en lugar de BullMQ con Redis:
  - BullMQ necesita un Redis siempre encendido y procesos consultándolo todo el tiempo; en Redis serverless cobra por comando y consume muchos. Eso contradice pagar solo por uso.
  - SQS invoca la función del siguiente paso solo cuando hay mensajes; sin tickets, no hay costo. Su nivel gratuito cubre un millón de solicitudes al mes.
  - Reintentos y cola de mensajes muertos vienen incluidos; la concurrencia de cada paso se limita por cola (por ejemplo, pocos navegadores de portal a la vez).
  - La cola está detrás de una interfaz: cambiarla no toca la lógica de negocio.

El diseño completo de Lambda (arranque en frío, memoria, costos y despliegue) está en [backend-design.md §8](./backend-design.md#8-infraestructura-y-costos).
