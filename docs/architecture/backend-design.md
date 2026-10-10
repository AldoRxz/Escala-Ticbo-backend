# Ticbo · Diseño del backend

Versión 0.2 · octubre 2026 · Estado: base implementada (identidad, sesiones, esquema multi-tenant, vault de secretos, empaquetado para AWS Lambda); pipeline de tickets diseñado, pendiente de implementar.

Objetivo de despliegue: **AWS Lambda con pago por uso** (sin servidores encendidos) y PostgreSQL en **Supabase** durante la etapa inicial.

Documentos relacionados:
- [Flujo del bot de WhatsApp](../product/flujo-del-bot.md): qué hace el producto, paso a paso.
- [Decisiones de costo](./decisiones-de-costo.md): las tres decisiones de arranque y cómo quedaron.

---

## 1. Contexto

Ticbo factura tickets de compra por WhatsApp. El usuario manda la foto de un ticket (por ejemplo, de Starbucks); Ticbo lee el ticket, identifica al comercio, entra a su portal de facturación con los datos fiscales que el cliente registró y le regresa el XML y el PDF del CFDI por el mismo chat.

Un punto que define la arquitectura: **Ticbo no timbra**. El CFDI lo emite el comercio a través de su PAC; Ticbo actúa por cuenta del receptor y automatiza la solicitud en el portal del comercio. Por eso el trabajo pesado no es el timbrado, sino:

1. Leer tickets heterogéneos (OCR o visión).
2. Mantener un catálogo de portales de facturación y un adaptador de automatización por portal.
3. Recibir el CFDI (por correo o descarga), validarlo ante el SAT y entregarlo.

### Restricciones

| Restricción | Consecuencia en el diseño |
|---|---|
| Costo mínimo, pago solo por uso | Todo el cómputo en AWS Lambda; cola en SQS; nada encendido esperando tráfico. Sin Redis, sin balanceador, sin NAT Gateway. Archivos en Cloudflare R2 (sin cargos de salida). |
| Multi-tenant B2B con datos fiscales | Un solo esquema con `account_id` y Row-Level Security de PostgreSQL: el aislamiento lo garantiza la base de datos, no solo el código. |
| WhatsApp y procesos de 3 s a varios minutos | El webhook responde `200` de inmediato y todo lo demás ocurre en funciones asíncronas disparadas por la cola. |
| Secretos de clientes (tokens de WhatsApp, e.firma/CSD) | Cifrado de sobre (*envelope encryption*) con una llave maestra fuera de la base de datos (variable protegida hoy, AWS KMS al desplegar); solo las funciones que los usan descifran. |

### Qué existe hoy en el código

- Proyecto NestJS 12 + Fastify 5 en TypeScript estricto (ESM).
- Esquema completo de PostgreSQL (14 tablas) con RLS en todas: aislamiento por cuenta en los datos de cliente y acceso exclusivo del rol de la API en las tablas de control.
- Módulo `iam`: registro e inicio de sesión con correo y contraseña (Argon2id), Google OAuth (OIDC + PKCE), JWT de acceso, refresh tokens rotativos con detección de reúso, guard global y decoradores.
- Módulo `vault`: cifrado de sobre AES-256-GCM con rotación de llaves.
- Handler de AWS Lambda (`src/lambda.ts`) y empaquetado (`npm run build:lambda`), probado en la imagen oficial de Lambda con Node 24.
- Health checks, errores en formato RFC 9457, configuración validada al arrancar.
- Docker Compose para desarrollo, imagen de contenedor como alternativa, 71 pruebas unitarias y 31 e2e contra Postgres real.

---

## 2. Vista general

```mermaid
flowchart LR
  subgraph Clientes
    WA[WhatsApp del usuario]
    WEB[App web<br/>app.ticbo.com]
  end

  subgraph Cloudflare
    CF[DNS · TLS · WAF<br/>rate limit en el borde]
    MAIL[Email Routing<br/>+ Email Worker]
    R2[(R2<br/>fotos · XML · PDF)]
  end

  META[WhatsApp Cloud API<br/>Meta]

  subgraph AWS
    GW[API Gateway<br/>HTTP API]
    API[Lambda api<br/>NestJS + Fastify]
    SQS[[SQS<br/>colas + DLQ]]
    WORKER[Lambdas worker<br/>OCR · portales · validación]
    SCHED[EventBridge Scheduler<br/>tareas periódicas]
  end

  PG[(Supabase PostgreSQL<br/>vía Supavisor)]
  PORTALES[Portales de facturación<br/>de comercios]
  SAT[Servicios SAT<br/>estado CFDI · lista 69-B]

  WA <--> META
  META -- webhook --> CF --> GW --> API
  WEB --> CF
  API --> PG
  API --> R2
  API -- encola --> SQS --> WORKER
  SCHED --> WORKER
  WORKER --> PG
  WORKER --> R2
  WORKER -- mensajes --> META
  WORKER -- navegador headless --> PORTALES
  PORTALES -- correo con CFDI --> MAIL --> R2
  MAIL -- aviso --> GW
  WORKER --> SAT
```

Todo el cómputo son funciones Lambda que salen del mismo código:

- **`api`** (`src/lambda.ts`): HTTP para la app web y los webhooks, detrás de API Gateway. Responde rápido y nunca hace trabajo largo. Para desarrollo y pruebas, `src/main.ts` levanta la misma aplicación como servidor HTTP.
- **Workers** (pendientes): una función por tipo de trabajo, disparada por su cola de SQS. La de portales usa más memoria (un Chromium headless necesita ~1.5 GB) y un timeout largo; las demás son pequeñas.
- **Tareas periódicas** (pendientes): EventBridge Scheduler invoca funciones para limpiar refresh tokens vencidos, reencolar tickets atascados y revalidar CFDI ante el SAT.

---

## 3. Arquitectura del código

### Capas (hexagonal / Clean Architecture)

```mermaid
flowchart TB
  P[presentation<br/>controladores HTTP, webhooks, DTOs Zod] --> A
  I[infrastructure<br/>Drizzle, Argon2, JWT, Google, R2, SQS, KMS] --> A
  A[application<br/>casos de uso + puertos] --> D[domain<br/>reglas y tipos puros]
```

La regla de dependencia apunta hacia adentro:

- **domain**: tipos, objetos de valor (`Email`), políticas (`assertAcceptablePassword`, `decideOAuthLink`) y errores. Sin NestJS, sin base de datos, sin HTTP.
- **application**: casos de uso (`RegisterUserUseCase`, `RefreshSessionUseCase`…) y los **puertos** que necesitan (`UserRepository`, `PasswordHasher`, `OAuthProvider`…). Solo conoce interfaces.
- **infrastructure**: adaptadores que implementan los puertos (`DrizzleUserRepository`, `Argon2PasswordHasher`, `GoogleOAuthProvider`).
- **presentation**: traduce HTTP a casos de uso y de vuelta: validación con Zod, cookies, códigos de estado.

Decisiones pragmáticas:

- Los puertos son **clases abstractas**, no interfaces. NestJS puede inyectarlas por tipo (`constructor(private users: UserRepository)`) sin tokens ni `@Inject`, y los adaptadores las implementan con `implements`.
- Los casos de uso llevan `@Injectable()`. Es solo metadata para el contenedor de dependencias; no los acopla a HTTP y se prueban instanciándolos a mano con dobles en memoria (`application/testing/fakes.ts`).
- Los errores esperados extienden `AppError` con un `code` estable y una `category` (`conflict`, `unauthenticated`…). Un único filtro global traduce la categoría a status HTTP; el dominio nunca habla de HTTP.

### Estructura de carpetas

```
src/
  lambda.ts                   entrada en AWS Lambda (API Gateway HTTP API)
  main.ts                     la misma API como servidor HTTP (desarrollo, contenedor)
  app.module.ts               composición: módulos, guards y filtro globales
  bootstrap/                  create-app (Fastify, cookies, helmet, CORS, /api/v1) y create-lambda-handler
  config/                     esquema Zod de variables de entorno → AppConfig tipado
  shared/
    domain/                   AppError, UUIDv7
    application/              Clock
    infrastructure/
      database/               Pool, Drizzle, esquema, TenantDatabase, migraciones, health
      http/                   filtro RFC 9457, ZodValidationPipe, rutas base
      storage/                (pendiente) adaptador S3/R2
      queue/                  (pendiente) adaptador SQS
  modules/
    iam/                      identidad y acceso          ✅ implementado
      domain/ application/ infrastructure/ presentation/
    health/                   probes de orquestación      ✅ implementado
    vault/                    cifrado de sobre de secretos ✅ implementado
    fiscal/                   perfiles fiscales (RFC receptor), e.firma/CSD
    messaging/                canal de WhatsApp: webhooks, envío de mensajes
    receipts/                 ingesta del ticket, OCR, máquina de estados
    invoicing/                catálogo de comercios, adaptadores de portal, CFDI
    billing/                  planes, suscripciones, límites de uso
drizzle/                      migraciones SQL generadas y manuales
scripts/                      setup-env (secretos locales), build-lambda (paquete para Lambda)
test/                         pruebas e2e contra PostgreSQL real
docker/                       script de inicialización de Postgres
docs/                         este documento y la documentación de producto
```

### Contextos (módulos)

| Módulo | Responsabilidad | Tablas |
|---|---|---|
| `iam` | Usuarios, inicio de sesión, sesiones, cuentas (tenants) y membresías | `users`, `user_identities`, `refresh_tokens`, `accounts`, `account_members` |
| `fiscal` | Datos del receptor que piden los portales; e.firma/CSD cuando aplique | `fiscal_profiles`, `fiscal_credentials` |
| `vault` | Sellar y abrir secretos de clientes; rotación de llaves | `encrypted_secrets` |
| `messaging` | Conectar números de WhatsApp, validar webhooks, enviar respuestas y documentos | `whatsapp_channels`, `whatsapp_senders` |
| `receipts` | Ticket recibido → datos extraídos → comercio y RFC elegidos | `receipts` |
| `invoicing` | Catálogo de portales, automatización, recepción y validación del CFDI | `merchants`, `invoices` |
| `billing` | Plan, ciclo, estado de pago, límites por plan | `subscriptions` |

Un módulo usa a otro solo a través de su capa de aplicación (casos de uso o puertos exportados), nunca leyendo sus tablas.

---

## 4. Modelo de datos (PostgreSQL)

### Plano de control y plano de datos

El tenant es la **cuenta** (`accounts`). Al registrarse, cada usuario recibe una cuenta personal de la que es dueño; además puede pertenecer a cuentas de organización (una PyME, un despacho contable) con un rol.

- **Plano de control** (sin RLS): tablas que se consultan *antes* de saber quién es el tenant, como el login, la renovación de sesión, el webhook de WhatsApp (solo trae el `phone_number_id`) o el webhook del proveedor de pagos. Solo contienen identidad, ruteo y facturación de Ticbo.
- **Plano de datos** (con RLS): todo dato fiscal o de negocio del cliente. Cada fila lleva `account_id` y PostgreSQL filtra por tenant.

```mermaid
erDiagram
  users ||--o{ user_identities : "OAuth"
  users ||--o{ refresh_tokens : "sesiones"
  users ||--o{ account_members : ""
  accounts ||--o{ account_members : ""
  accounts ||--o{ subscriptions : ""
  accounts ||--o{ fiscal_profiles : ""
  accounts ||--o{ encrypted_secrets : ""
  fiscal_profiles ||--o{ fiscal_credentials : "e.firma / CSD"
  encrypted_secrets ||--o{ fiscal_credentials : "llave y contraseña"
  accounts ||--o{ whatsapp_channels : "número propio"
  whatsapp_channels ||--o{ whatsapp_senders : "teléfonos autorizados"
  accounts ||--o{ receipts : ""
  fiscal_profiles ||--o{ receipts : "RFC elegido"
  merchants ||--o{ receipts : "comercio detectado"
  receipts ||--o| invoices : "CFDI obtenido"
  fiscal_profiles ||--o{ invoices : "receptor"
```

| Tabla | Plano | Propósito |
|---|---|---|
| `users` | control | Persona que inicia sesión. Correo único en minúsculas (CHECK). `password_hash` nulo si solo usa OAuth. |
| `user_identities` | control | Vínculo con Google/Facebook por `(provider, subject)`; el `sub` del proveedor nunca cambia, el correo sí. |
| `refresh_tokens` | control | Hash SHA-256 de cada refresh token, familia, expiración, rotación (`replaced_by_id`) y revocación. |
| `accounts` | control | El tenant: `personal` u `organization`. |
| `account_members` | control | Usuario ↔ cuenta con rol `owner`, `admin`, `member` o `viewer`. |
| `subscriptions` | control | Plan (`pro`, `negocio`, `despacho`), ciclo, estado e ids del proveedor de pagos. Índice único parcial: una sola suscripción no cancelada por cuenta. Los límites de cada plan viven en código, junto al catálogo de planes. |
| `whatsapp_channels` | control | Número de WhatsApp Business conectado: `phone_number_id` (llave de ruteo del webhook), WABA y referencias a sus secretos. `account_id` nulo = número compartido de Ticbo. |
| `whatsapp_senders` | control | Teléfonos autorizados a mandar tickets a un canal, con su usuario y RFC por defecto. |
| `merchants` | global | Catálogo compartido: comercio, RFC emisor, URL del portal, adaptador, campos que pide el portal y días de vigencia para facturar. |
| `encrypted_secrets` | datos | Secretos cifrados (ver §7). |
| `fiscal_profiles` | datos | RFC, razón social, régimen fiscal, código postal, uso de CFDI por defecto y buzón de Ticbo al que llegan los CFDI. CHECK de formato de RFC y CP. |
| `fiscal_credentials` | datos | e.firma o CSD: certificado público y referencias a la llave privada y su contraseña en el vault. |
| `receipts` | datos | El ticket: origen, id del mensaje (idempotencia), foto en R2, datos extraídos, estado del pipeline, intentos y último error. |
| `invoices` | datos | El CFDI recibido: UUID fiscal, emisor, receptor, totales, llaves de XML/PDF en R2, estado ante el SAT y estado del emisor en la lista 69-B. |

### Aislamiento entre tenants

Elegimos un esquema compartido con `account_id` y Row-Level Security, en lugar de un esquema o una base de datos por cliente:

- **Costo**: una sola base de datos pequeña sirve a todos los clientes; esquemas por tenant multiplican catálogos, migraciones y conexiones.
- **Operación**: una migración, un pool, un respaldo.
- **Seguridad en profundidad**: aunque un desarrollador olvide un `WHERE account_id = …`, PostgreSQL no devuelve ni modifica filas de otro tenant.

Cómo funciona (migración `drizzle/0001_tenant_isolation.sql`):

1. La API se conecta como `ticbo_app`, un rol que **no es dueño** de las tablas, así que las políticas se le aplican siempre. Las migraciones corren con el rol dueño.
2. El código de negocio entra a datos de cliente solo a través de `TenantDatabase.run(accountId, tx => …)`, que abre una transacción y ejecuta `set_config('app.account_id', accountId, true)`. El `true` limita el valor a esa transacción: no se filtra a otra petición y es compatible con PgBouncer en modo transacción.
3. Cada tabla de datos tiene la política `account_id = app_current_account_id()` para lectura (`USING`) y escritura (`WITH CHECK`).
4. **Falla cerrado**: sin `app.account_id` no se ve ninguna fila.
5. Las llaves foráneas entre tablas de cliente son **compuestas con `account_id`** (por ejemplo, `receipts(fiscal_profile_id, account_id) → fiscal_profiles(id, account_id)`). Es necesario porque PostgreSQL valida llaves foráneas sin aplicar RLS: con una llave simple, un tenant que conociera un id ajeno podría referenciarlo.

Las pruebas e2e de `test/tenant-isolation.e2e-spec.ts` lo verifican con códigos SQLSTATE: lectura aislada, falla cerrada, escritura rechazada (42501), referencia cruzada rechazada (23503) y formato de RFC (23514).

### Supabase

La etapa inicial usa PostgreSQL de Supabase **solo como base de datos**: no usamos Supabase Auth, la Data API (PostgREST) ni Storage. La migración `drizzle/0002_managed_postgres_hardening.sql` lo deja explícito:

- Supabase publica el esquema `public` por su Data API con los roles `anon` y `authenticated`, cuya llave viaja en navegadores, y por defecto les da acceso a cada tabla nueva. La migración les quita todo privilegio. Además, hay que **desactivar la Data API** en el panel (Project Settings → Data API).
- RLS en **todas** las tablas: las de control solo tienen una política para `ticbo_app`, así que cualquier otro rol que no sea dueño ve cero filas.
- `statement_timeout` (10 s) e `idle_in_transaction_session_timeout` (15 s) se fijan en el rol `ticbo_app`, porque los poolers rechazan esos parámetros al conectar.

Conexiones:

| Uso | Conexión de Supabase | Usuario |
|---|---|---|
| API en Lambda (`DATABASE_URL`) | *Transaction pooler* (Supavisor, puerto 6543) | `ticbo_app.<project-ref>` |
| Migraciones (`DATABASE_MIGRATION_URL`) | *Session pooler* (puerto 5432; la conexión directa es solo IPv6) | `postgres.<project-ref>` |

SSL con verificación: `DATABASE_SSL=true` y el certificado raíz de Supabase en `DATABASE_SSL_CA` (sin `sslmode` en la URL, porque node-postgres lo deja sobrescribir la verificación). El rol `ticbo_app` se crea una vez con `CREATE ROLE ticbo_app LOGIN PASSWORD '…'` antes de la primera migración.

Todo el diseño es compatible con el modo transacción del pooler: el contexto de tenant (`set_config(..., true)`) vive dentro de la transacción y node-postgres usa sentencias preparadas sin nombre. Cambiar a RDS o Aurora Serverless más adelante es cambiar las URLs.

### Convenciones

- **Ids UUIDv7** generados por la aplicación: ordenados por tiempo (inserciones al final del índice B-tree) y conocidos antes de escribir. El `DEFAULT gen_random_uuid()` existe solo para inserciones manuales.
- Fechas `timestamptz`; dinero `numeric(14,2)`, nunca flotantes.
- Enums de PostgreSQL para conjuntos estables (estados, roles). Agregar un valor es barato (`ALTER TYPE … ADD VALUE`).
- Índices pensados para las consultas del tablero: `(account_id, created_at DESC)` en tickets y `(account_id, issued_at DESC)` en facturas.
- Cuando `receipts` e `invoices` pasen de decenas de millones de filas, se particionan por mes; las llaves ya incluyen `account_id` para facilitarlo.

### Migraciones

- El esquema vive en `src/shared/infrastructure/database/schema/*.ts` (Drizzle).
- `npm run db:generate` crea el SQL en `drizzle/`. Lo que Drizzle no expresa (RLS, permisos, funciones) va en migraciones manuales: `npx drizzle-kit generate --custom --name <nombre>`.
- `npm run db:migrate` aplica lo pendiente con `DATABASE_MIGRATION_URL`. En producción corre como paso del pipeline de despliegue (CI), antes de publicar la nueva versión de las funciones.

---

## 5. Autenticación y autorización

### Resumen

| Mecanismo | Implementación |
|---|---|
| Correo y contraseña | Argon2id (19 MiB, 2 pasadas, 1 hilo; sal aleatoria de 16 bytes por hash) |
| Federado | Google con OpenID Connect, flujo *authorization code* + PKCE S256 + `state` + `nonce` |
| Token de acceso | JWT HS256 de 15 min con `sub`, `sid`, `acc` (cuenta activa) y `role`; se verifica sin consultar la base de datos |
| Sesión | Refresh token opaco de 256 bits, guardado como hash, en cookie `httpOnly`, rotado en cada uso, con detección de reúso |
| Rutas protegidas | Guard global `JwtAuthGuard`: toda ruta exige `Bearer` salvo las marcadas con `@Public()` |

### Endpoints

| Método y ruta | Acceso | Descripción |
|---|---|---|
| `POST /api/v1/auth/register` | público | Crea usuario y cuenta personal; responde el token de acceso y fija la cookie de sesión. `409 email_already_registered` si el correo existe. |
| `POST /api/v1/auth/login` | público | Correo y contraseña. `401 invalid_credentials` con la misma respuesta y el mismo trabajo de hash exista o no el correo. |
| `POST /api/v1/auth/refresh` | cookie | Rota el refresh token y entrega un token de acceso nuevo. |
| `POST /api/v1/auth/logout` | cookie | Revoca la familia de la sesión y borra la cookie. `204`. |
| `GET /api/v1/auth/oauth/:provider` | público | Redirige al proveedor (`google`). `404 oauth_provider_not_enabled` si no está configurado. |
| `GET /api/v1/auth/oauth/:provider/callback` | público | Valida `state`, intercambia el código, inicia sesión y redirige a `WEB_APP_URL/auth/callback` (o a `/login?error=<code>`). |
| `GET /api/v1/me` | Bearer | Usuario, cuenta activa y todas sus cuentas. |
| `GET /api/v1/health` | público | Readiness: `200` o `503` si PostgreSQL no responde. |
| `GET /api/v1/health/live` | público | Liveness: el proceso responde. |

Los errores siguen RFC 9457 (`application/problem+json`) con un `code` estable para el frontend y el `requestId` para soporte:

```json
{
  "type": "about:blank",
  "title": "Bad Request",
  "status": 400,
  "code": "validation_failed",
  "detail": "The request is invalid.",
  "errors": [{ "path": "password", "message": "Passwords must be between 12 and 128 characters long.", "code": "custom" }],
  "instance": "/api/v1/auth/register",
  "requestId": "6c28899b-ceba-4c89-b315-c18ca4179e72"
}
```

### Tokens y su almacenamiento en el cliente

```mermaid
sequenceDiagram
  participant B as App web
  participant A as API
  participant D as PostgreSQL
  B->>A: POST /auth/login {email, password}
  A->>D: usuario + verificación Argon2id
  A->>D: INSERT refresh_tokens (hash, familia nueva)
  A-->>B: 200 {accessToken, expiresIn: 900} + Set-Cookie ticbo_rt (httpOnly, Strict)
  Note over B: el access token vive solo en memoria
  B->>A: GET /me  Authorization: Bearer …
  A-->>B: 200 (verificación local del JWT, sin BD)
  B->>A: POST /auth/refresh (cookie)
  A->>D: UPDATE … SET revoked_at, replaced_by WHERE id = ? AND revoked_at IS NULL
  A->>D: INSERT nuevo token en la misma familia
  A-->>B: 200 {accessToken} + Set-Cookie (token nuevo)
```

- **Access token en memoria, nunca en `localStorage`**: un XSS no puede robar una sesión duradera.
- **Refresh token en cookie** `httpOnly` (JavaScript no la lee), `SameSite=Strict` (no viaja en peticiones de otro sitio, lo que también elimina CSRF sobre `/auth/refresh`) y `Path=/api/v1/auth` (no viaja al resto de la API). `Secure` siempre que la API esté en https. `app.ticbo.com` y `api.ticbo.com` son el mismo sitio, así que la cookie funciona entre ambos.
- **Rotación con detección de reúso**: cada refresh token sirve una vez. Si llega uno ya rotado, se asume robado y se revoca la familia entera: el atacante y el usuario legítimo deben volver a iniciar sesión. Hay una ventana de gracia configurable (10 s) para dos pestañas que renuevan al mismo tiempo: la que pierde recibe `401` sin cerrar la sesión de la otra.
- La rotación es un *compare-and-set* en SQL: de dos rotaciones concurrentes del mismo token, solo una gana.
- Expiración deslizante de 30 días por inactividad (`REFRESH_TOKEN_TTL_DAYS`).
- El token de acceso no se puede revocar antes de que expire (15 min); es el precio de no consultar la base de datos en cada petición. Cambios de rol o de cuenta se reflejan en la siguiente renovación.
- Las respuestas con tokens llevan `Cache-Control: no-store`.

### Google OAuth sin Passport

```mermaid
sequenceDiagram
  participant B as Navegador
  participant A as API
  participant G as Google
  B->>A: GET /auth/oauth/google
  A-->>B: 302 a Google (code_challenge, state, nonce) + cookie firmada ticbo_oauth (10 min, Lax)
  B->>G: consentimiento
  G-->>B: 302 /auth/oauth/google/callback?code&state
  B->>A: callback + cookie ticbo_oauth
  A->>A: state == cookie (comparación en tiempo constante)
  A->>G: POST /token (code + code_verifier + client_secret)
  G-->>A: id_token
  A->>A: valida iss, aud, exp, nonce, email_verified
  A-->>B: 302 WEB_APP_URL/auth/callback + Set-Cookie ticbo_rt
  B->>A: POST /auth/refresh → accessToken
```

No usamos Passport.js:

- Sus estrategias OAuth asumen Express y sesiones de servidor (para guardar `state` y el verificador PKCE). Sobre Fastify requieren adaptaciones y un almacén de sesiones que no queremos operar.
- El flujo sin estado (`state`, `code_verifier` y `nonce` en una cookie firmada de 10 minutos) son unas 150 líneas, auditables y probadas.
- La abstracción es el patrón *strategy*: el puerto `OAuthProvider` y un `OAuthProviderRegistry`. Agregar Facebook o Microsoft es escribir un adaptador y registrarlo; las rutas y la lógica de vinculación no cambian.

Tampoco Auth0, Clerk o Supabase Auth en esta etapa: cobran por usuario activo mensual, agregan un proveedor crítico más y la parte difícil (cuentas, tenants, roles) seguiría siendo nuestra. El puerto permite cambiar de opinión después.

El `id_token` llega directo del endpoint de tokens de Google por TLS, así que, según OpenID Connect Core §3.1.3.7, no es necesario verificar su firma. Sí se validan todas las *claims* que lo atan a este inicio de sesión: emisor, audiencia, expiración y `nonce`.

### Reglas de seguridad implementadas

- **Contraseñas**: 12 a 128 caracteres contados como puntos de código, sin reglas de composición (NIST SP 800-63B); normalización NFKC antes de hashear. Si cambian los parámetros de Argon2, el hash se actualiza en el siguiente login.
- **Sin enumeración de cuentas en el login**: correo inexistente, usuario solo-OAuth y contraseña incorrecta dan la misma respuesta tras el mismo trabajo de Argon2 (contra un hash señuelo). El registro sí responde `409` si el correo existe, por usabilidad, y lo compensa con un límite de peticiones.
- **Robo de cuenta por pre-registro**: si alguien registra el correo de otra persona sin verificarlo y luego la dueña real entra con Google, se vincula la identidad, **se borra la contraseña del intruso y se revocan sus sesiones** (`decideOAuthLink`).
- **Límites de peticiones** por IP: 10/min en registro y login, 20/min en OAuth, 30/min en el resto de `/auth`, 120/min global. Los health checks no tienen límite. En Lambda estos contadores viven en cada instancia, así que el límite real lo ponen API Gateway (*throttling* por ruta) y una regla de rate limit de Cloudflare; los de la app quedan como segunda capa.
- **CORS** solo para los orígenes de `CORS_ORIGINS`, con credenciales.
- **Cabeceras** de `@fastify/helmet` (HSTS, `nosniff`, sin `x-powered-by`…).
- **Logs** en JSON (pino) con id de petición; se registra la ruta sin query string, porque ahí viajan los códigos OAuth.
- **Configuración** validada con Zod al arrancar; un error lista todas las variables inválidas sin mostrar sus valores. No hay credenciales en el código: `npm run setup:env` genera secretos aleatorios para desarrollo.

### Autorización y tenants

- El token lleva la cuenta activa (`acc`) y el rol en ella (`role`). Al iniciar sesión, la cuenta activa es la personal.
- Las rutas de datos de cliente usarán `principal.accountId` para abrir `TenantDatabase.run(...)`: el tenant sale del token firmado, nunca del body ni de la URL.
- Roles: `owner` (todo, incluida la facturación de Ticbo), `admin` (usuarios, RFCs, números de WhatsApp), `member` (manda tickets, ve los suyos), `viewer` (contador o auditor de solo lectura).

### Pendientes de identidad

| Pendiente | Motivo |
|---|---|
| Verificación de correo y recuperación de contraseña | Requiere correo transaccional (Amazon SES o Resend). Hasta entonces, exigir correo verificado antes de cargar e.firma/CSD. |
| `POST /auth/switch-account` y `RolesGuard` | Cambiar de cuenta activa y restringir rutas por rol. |
| MFA (TOTP) para `owner` y `admin` | Esas cuentas controlan datos fiscales de terceros. |
| Bloqueo progresivo por cuenta | El límite por IP no frena ataques distribuidos contra un solo correo. |
| Rate limit por cuenta | Los contadores en memoria no se comparten entre instancias de Lambda; el bloqueo por correo atacado se guarda en Postgres. |
| Bitácora de auditoría (`audit_events`) | Inicios de sesión, cambios de rol y cada acceso a secretos del vault. |
| Rotación de `JWT_ACCESS_SECRET` | Usar `kid` y aceptar dos secretos durante la transición. |

---

## 6. Pipeline asíncrono: de la foto al CFDI

> Estado: diseñado; el esquema (`whatsapp_channels`, `whatsapp_senders`, `receipts`, `merchants`, `invoices`) ya existe, los módulos `messaging`, `receipts` e `invoicing` están por implementar.

Ver el flujo de producto completo en [flujo-del-bot.md](../product/flujo-del-bot.md). Aquí está lo técnico.

### Conexión de WhatsApp

Cada cliente conecta **su propio número** de WhatsApp Business: captura en la app el `phone_number_id`, el WABA id, el token de acceso y el *app secret* de su app de Meta. Ticbo los guarda cifrados (§7) y le muestra la URL del webhook y un *verify token* para registrar en Meta.

- Webhook por canal: `GET/POST /api/v1/webhooks/whatsapp/:channelId`. El `GET` responde el *challenge* de verificación de Meta comparando el *verify token* contra su hash.
- Cada `POST` se valida con `X-Hub-Signature-256` (HMAC-SHA256 del cuerpo crudo con el *app secret* del canal). Sin firma válida, `401`. El parser JSON propio (`create-app.ts`) debe guardar el cuerpo crudo para esa ruta.
- Para que Meta no espere un arranque en frío de toda la API, el webhook puede vivir en su propia función pequeña (sin NestJS) que solo valida, encola y responde.
- El canal se resuelve por `phone_number_id` en `whatsapp_channels` (plano de control) y el remitente por `wa_id` en `whatsapp_senders`. Un teléfono no autorizado recibe un mensaje de "número no registrado" y no genera trabajo.
- A futuro, Ticbo puede registrarse como *Tech Provider* de Meta y usar *Embedded Signup*: el cliente conecta su número con unos clics y un solo webhook atiende a todos los canales, ruteado por `phone_number_id`. El modelo de datos ya lo soporta.

### Etapas

```mermaid
sequenceDiagram
  participant U as Usuario (WhatsApp)
  participant M as Meta
  participant API
  participant Q as Cola (SQS)
  participant W as Lambda worker
  participant P as Portal del comercio
  participant E as Email Worker
  U->>M: foto del ticket
  M->>API: POST webhook
  API->>API: firma HMAC · canal · remitente · idempotencia
  API->>Q: receipt.ingest
  API-->>M: 200 OK (en milisegundos)
  W->>M: descarga la imagen
  W->>W: guarda en R2 · OCR → comercio, folio, total, fecha
  W->>U: "Recibí tu ticket de Starbucks por $185.00, lo facturo a ABC010101XYZ"
  W->>P: navegador headless llena el portal con ticket + datos fiscales
  P->>E: correo con XML y PDF al buzón del RFC
  E->>API: aviso (archivos ya en R2)
  W->>W: valida XML · estado en el SAT · emisor en lista 69-B
  W->>U: documentos XML y PDF
```

| Trabajo | Qué hace | Reintentos |
|---|---|---|
| `receipt.ingest` | Descarga la imagen de Meta, la guarda en R2, crea `receipts` (idempotente por `source_message_id`) | 5, backoff exponencial |
| `receipt.extract` | OCR o visión → comercio, RFC emisor, folio, fecha, total, sucursal; confianza por campo | 3 |
| `receipt.match` | Busca el comercio en `merchants`; elige RFC receptor (remitente → perfil por defecto; si hay varios, pregunta en el chat) | — |
| `invoice.request` | Ejecuta el adaptador del portal (`merchants.adapter_key`) con los datos del ticket y del perfil fiscal | 3, luego `needs_review` |
| `invoice.collect` | Asocia el correo entrante (o la descarga del portal) con el ticket; guarda XML/PDF en R2 | espera hasta 24 h |
| `invoice.validate` | Valida el XML (UUID, receptor correcto, totales), consulta el estado en el SAT y la lista 69-B del emisor | 5 |
| `notify.send` | Envía mensajes y documentos por WhatsApp | 5 |

Estados de `receipts.status`: `received → extracting → requesting_invoice → awaiting_cfdi → invoiced`, con salidas a `needs_review` (requiere intervención humana) o `failed`.

### Cola: SQS

La nota de costos original proponía BullMQ con Redis, y la primera versión de este diseño usaba pg-boss en Postgres. Con todo el cómputo en Lambda, ambas opciones obligan a tener un proceso encendido consultando la cola. **SQS** dispara las funciones solo cuando hay mensajes:

- **Pago por uso**: 1 millón de solicitudes al mes gratis y después centavos por millón. Nada cobra mientras no hay tickets.
- **Reintentos y cola de mensajes muertos** nativos: cada cola tiene su DLQ y su *visibility timeout* ajustado a la etapa (segundos para mensajes, minutos para portales).
- **Concurrencia por cola**: la de portales se limita (`maximum concurrency` del disparador) para no saturar ni la base de datos ni los portales de los comercios.
- **Consistencia sin cola transaccional**: SQS no participa en la transacción de Postgres. El estado del ticket (`receipts.status`) hace de bandeja de salida: se guarda primero y se encola después; si el envío a SQS falla, una tarea periódica reencola los tickets que lleven más de unos minutos en un estado sin avanzar. Los consumidores son idempotentes (por id de ticket y de mensaje de WhatsApp), porque SQS entrega *al menos una vez*.

La cola queda detrás de un puerto (`JobQueue`), así que el código de negocio no depende de SQS.

### Automatización de portales

- Un **adaptador por portal** (`invoicing/infrastructure/portals/<comercio>.adapter.ts`) implementa el puerto `MerchantPortal`: recibe los datos del ticket y del perfil fiscal y regresa "solicitado", "ya facturado", "fuera de plazo" o "requiere revisión".
- Corre con **Playwright** y un Chromium para Lambda (`@sparticuz/chromium`) en su propia función: ~1.5 GB de memoria y hasta 5 minutos de timeout, cobrada solo mientras llena un portal. Alternativa también por uso: Cloudflare Browser Rendering.
- El correo que se captura en el portal es el **buzón del perfil fiscal** (`fiscal_profiles.invoice_email`), así el CFDI llega a Ticbo por Cloudflare Email Routing, que es gratuito, y un Email Worker lo deja en R2.
- Los portales cambian sin aviso: cada adaptador tiene una prueba de humo diaria y el comercio pasa a `degraded` si falla, para avisar al usuario en vez de reintentar a ciegas.
- Los CAPTCHA y los casos raros pasan a `needs_review` (cola humana en el panel), nunca a reintentos infinitos.
- `merchants.invoice_window_days` evita intentar tickets vencidos (muchos portales solo facturan dentro del mes de compra).

### Reglas de WhatsApp que afectan el costo

- Dentro de las 24 h posteriores al último mensaje del usuario se responde con mensajes libres. Fuera de esa ventana solo se pueden enviar plantillas aprobadas, con costo por mensaje.
- La mayoría de los CFDI llegan en minutos; si uno tarda más de 24 h, la entrega usa una plantilla de "tu factura está lista".

### OCR

El puerto `ReceiptReader` tiene dos candidatos de pago por uso, sin infraestructura propia: Amazon Textract AnalyzeExpense (especializado en tickets) o un modelo de visión multimodal que devuelva directamente JSON estructurado. Se decide con una prueba sobre 200 tickets reales mexicanos (gasolina, restaurantes, conveniencia), midiendo precisión por campo y costo por ticket.

---

## 7. Secretos de clientes y cifrado

> Estado: implementado (`src/modules/vault`) con llaves maestras locales (`VAULT_KEYS`); el adaptador de AWS KMS se agrega al desplegar en AWS.

### Qué se guarda y por qué

| Secreto | Para qué | Cuándo se pide |
|---|---|---|
| Token de acceso de WhatsApp y *app secret* | Enviar mensajes y validar webhooks del número del cliente | Al conectar el canal |
| e.firma (FIEL): `.key` y contraseña | Descarga masiva de CFDI recibidos desde el SAT (plan Despacho) | Solo si se activa esa función |
| CSD: `.key` y contraseña | Solo si algún día Ticbo emite CFDI a nombre del cliente | Hoy no se necesita |

El flujo principal (solicitar la factura en el portal del comercio) **no requiere e.firma ni CSD**: los portales solo piden RFC, razón social, régimen, código postal, uso de CFDI y correo. Pedir una llave privada que no se usa solo aumenta el riesgo, así que se pide únicamente al activar la función que la necesita.

### Cifrado de sobre

```mermaid
flowchart LR
  S[secreto en claro] -->|AES-256-GCM<br/>DEK aleatoria por secreto<br/>AAD = account_id + kind + id| C[ciphertext]
  DEK[DEK] -->|KMS Encrypt| W[DEK envuelta]
  C --> T[(encrypted_secrets)]
  W --> T
  K[KEK en AWS KMS<br/>nunca sale del KMS] -.-> W
```

- Cada secreto se cifra con su propia llave de datos (DEK) usando AES-256-GCM. La DEK se cifra ("envuelve") con una llave maestra (KEK) que vive en AWS KMS y nunca sale de ahí. En la tabla solo quedan el texto cifrado (IV + tag + datos), la DEK envuelta y el id de la KEK.
- **AAD** (datos autenticados) = `account_id`, tipo e id del secreto. Si alguien copia el texto cifrado a otra fila u otra cuenta, el descifrado falla.
- **Solo los workers descifran**, y solo justo antes de usar el secreto. La API escribe secretos pero nunca los devuelve: la app muestra "conectado" y la fecha, no el valor.
- **Rotación**: rotar la KEK significa volver a envolver las DEK (`key_id` indica cuáles faltan), sin tocar los datos.
- **Costo**: una llave de KMS cuesta del orden de 1 USD al mes y las operaciones se cobran por cada 10,000. Las DEK descifradas se cachean unos minutos en memoria de la función para no llamar a KMS en cada mensaje.
- **Hoy** las KEK vienen de `VAULT_KEYS` (`id:llave` separadas por coma; la primera cifra, todas descifran). Viven en el gestor de secretos de la plataforma, nunca en la base de datos: un respaldo o una fuga de la base no basta para leer secretos. El código de negocio solo conoce `SecretVault`; cambiar a KMS es reemplazar `LocalKeyWrapper` por un adaptador que llame a `kms:Encrypt`/`kms:Decrypt` con el mismo contexto.
- **Rotar una llave local**: agregar la nueva al inicio de `VAULT_KEYS`, desplegar, volver a envolver las DEK de los secretos con `key_id` viejo y retirar la llave anterior.

Los secretos de la propia plataforma (`JWT_ACCESS_SECRET`, `COOKIE_SECRET`, contraseñas de la base de datos) viven en el gestor de secretos del proveedor de despliegue, nunca en archivos del repositorio.

---

## 8. Infraestructura y costos

### Principio: pagar solo por uso

Nada queda encendido esperando tráfico. Cada pieza cobra por petición, por milisegundo o por mensaje, y la mayoría tiene un nivel gratuito que cubre la etapa de lanzamiento:

| Pieza | Elección | Cómo cobra |
|---|---|---|
| Borde | Cloudflare (plan gratuito): DNS, TLS, WAF, regla de rate limit | Gratis |
| Entrada HTTP | API Gateway **HTTP API** (no REST API) | Por millón de peticiones |
| Cómputo | AWS Lambda en **arm64** (Graviton), Node.js 24 | Por petición y por GB-segundo; incluye un nivel gratuito permanente |
| Cola | SQS estándar con cola de mensajes muertos | Por millón de solicitudes; nivel gratuito permanente |
| Tareas periódicas | EventBridge Scheduler | Por invocación; nivel gratuito amplio |
| Base de datos | Supabase PostgreSQL (plan Pro para producción: el gratuito se pausa por inactividad) | Cuota mensual fija: es el único costo fijo relevante |
| Archivos | Cloudflare R2 | Por GB almacenado; **sin cargos de salida** |
| Correo entrante | Cloudflare Email Routing + Email Worker | Gratis |
| Secretos de clientes | AWS KMS (una llave, al desplegar) | ~1 USD al mes + por cada 10,000 operaciones |
| Configuración de la plataforma | SSM Parameter Store (nivel estándar) | Gratis |
| Logs | CloudWatch Logs, retención de 14 días | Por GB ingerido |

Los precios son de referencia: confirmarlos en la calculadora de AWS antes de lanzar. Con el volumen del plan más grande (2,000 facturas al mes por cuenta) y decenas de cuentas, el cómputo, la cola y la entrada HTTP quedan dentro o muy cerca de los niveles gratuitos; el costo fijo es Supabase.

Trampas de costo que evitamos a propósito:

- **Lambda fuera de una VPC.** Supabase y los servicios externos (Meta, portales, SAT) se alcanzan por internet con TLS. Meter las funciones en una VPC obligaría a pagar un NAT Gateway (cobro fijo por hora más cobro por GB) solo para salir a internet.
- **Sin balanceador (ALB)**, sin Redis, sin contenedores encendidos.
- **HTTP API en lugar de REST API** de API Gateway: es varias veces más barata y alcanza para lo que necesitamos (rutas, CORS, throttling, dominio propio).
- **Logs con retención corta y nivel `warn` en producción.** Cada petición genera líneas de log y CloudWatch cobra por GB ingerido; en producción el log de cada petición no hace falta.

### Arranque en frío

Una función que no ha recibido tráfico tarda en arrancar. AWS cobra también esa fase de arranque, así que conviene que sea corta:

- El paquete es un solo archivo ESM minificado (`npm run build:lambda`, ~2 MB), sin `node_modules` que leer del disco salvo el binario de Argon2.
- La aplicación se construye una vez por instancia y se reutiliza en cada invocación.
- Medido en la imagen oficial de Lambda (Node 24): arranque ~0.4 s, primera petición con conexión a la base ~0.45 s y peticiones siguientes de 5 a 60 ms.
- Si el arranque en frío llega a molestar en el login, la opción es *provisioned concurrency* en la función `api`, pero tiene costo fijo: no se activa en esta etapa.

### Dimensionamiento

- **Memoria de la función `api`: 512 MB.** En Lambda la CPU es proporcional a la memoria. Argon2id usa 19 MiB por hash y tarda menos con más CPU; si el login se siente lento, subir a 768 o 1024 MB puede costar lo mismo, porque cada petición dura menos.
- **Pool de conexiones: 1 por instancia** (`DATABASE_POOL_MAX=1`). Una instancia de Lambda atiende una petición a la vez; la multiplexación la hace el *transaction pooler* de Supabase.
- **Timeouts**: `statement_timeout` de 10 s e `idle_in_transaction_session_timeout` de 15 s en el rol `ticbo_app`; timeout de la función `api` de 10 s.
- **Región**: la misma región de AWS que el proyecto de Supabase, para que la latencia entre la función y la base sea mínima.

### Caché en el borde

- Las respuestas de la API son privadas (`no-store`) y no se cachean.
- Los archivos en R2 no son públicos: la API entrega URLs firmadas de vida corta (5 min) para cada XML/PDF/foto.
- La landing y sus pantallas de acceso se sirven como sitio estático o con renderizado en el borde (Vercel o Cloudflare Pages).

### Cuándo cambiar algo

| Señal | Acción |
|---|---|
| Arranques en frío visibles en el login | *Provisioned concurrency* de 1 en la función `api` en horario laboral |
| Supabase llega al límite de conexiones o de CPU | Subir de plan o de instancia; revisar consultas lentas |
| Cola con retraso de más de 1 minuto | Subir la concurrencia máxima de su disparador |
| La base debe vivir dentro de AWS (cumplimiento, latencia) | RDS o Aurora Serverless con RDS Proxy; las funciones entran a la VPC con VPC endpoints para no pagar NAT |

### Observabilidad

- Hoy: logs JSON con `reqId`, `requestId` en cada error devuelto, readiness y liveness.
- Siguiente: métricas de Lambda y SQS en CloudWatch (errores, duración, mensajes en la DLQ) con alarmas por correo, trazas con AWS X-Ray o OpenTelemetry, y métricas de negocio: tickets por estado, tiempo de foto a CFDI y tasa de éxito por portal.

---

## 9. Desarrollo y despliegue

```bash
npm install
npm run setup:env        # .env con secretos locales aleatorios
npm run db:up            # PostgreSQL 18 en Docker
npm run db:migrate
npm run start:dev        # la API como servidor: http://localhost:4000/api/v1/health
npm test                 # unitarias
npm run test:e2e         # e2e contra la base ticbo_test, incluido el handler de Lambda
npm run build:lambda     # paquete para Lambda en dist-lambda/api (handler index.handler)
```

Para probar el paquete exactamente como corre en AWS: `npm run build:lambda -- --arch=x64` y levantar `dist-lambda/api` con la imagen `public.ecr.aws/lambda/nodejs:24`, que incluye el emulador de Lambda.

**Despliegue a AWS** (pendiente: plantilla de infraestructura con AWS SAM):

1. CI ejecuta pruebas, `npm run db:migrate` contra Supabase y `npm run build:lambda`.
2. SAM publica la función `api` (arm64, 512 MB, 10 s), la HTTP API con dominio `api.ticbo.com`, las colas SQS con sus DLQ y los permisos mínimos.
3. Las variables sensibles se leen de SSM Parameter Store en el despliegue; nunca se escriben en la plantilla.

Las migraciones deben ser compatibles hacia atrás (expandir y luego contraer), para que la versión anterior de las funciones siga funcionando mientras se publica la nueva.

`Dockerfile` y `docker compose --profile app` siguen disponibles para correr la misma API como contenedor si algún cliente o ambiente lo necesita.

---

## 10. Registro de decisiones

| # | Decisión | Alternativas descartadas | Motivo |
|---|---|---|---|
| 1 | NestJS 12 + Fastify 5, ESM | Express; Fastify solo | Estructura modular e inyección de dependencias para un equipo que crecerá; Fastify consume menos CPU y memoria que Express |
| 2 | Drizzle ORM + `pg` | Prisma, TypeORM | Sin motor binario ni proceso extra, paquete pequeño para Lambda; SQL explícito; migraciones SQL revisables |
| 3 | Zod para entrada y configuración | class-validator | Un solo lenguaje de validación para HTTP y variables de entorno; tipos inferidos |
| 4 | Esquema compartido + RLS | Esquema o base por tenant | Costo y operación; aislamiento garantizado por la base de datos |
| 5 | SQS | pg-boss en Postgres; BullMQ + Redis | Pago por uso: no exige un proceso encendido consultando la cola; reintentos y DLQ nativos |
| 6 | Cloudflare R2 | S3 estándar | Sin cargos de salida; API S3 compatible |
| 7 | OAuth propio sobre el puerto `OAuthProvider` | Passport.js, Auth0/Supabase Auth | Sin sesiones de servidor; sin costo por usuario; vinculación de cuentas bajo nuestro control |
| 8 | JWT de acceso HS256 + refresh opaco rotativo | Sesiones en servidor; JWT de larga vida | Verificación sin base de datos en cada petición, con revocación real en el refresh |
| 9 | Argon2id | bcrypt | Resistente a GPU por costo de memoria; recomendado por OWASP |
| 10 | UUIDv7 generados por la app | `bigserial`, UUIDv4 | Ordenados por tiempo, sin coordinación, no enumerables |
| 11 | AWS Lambda + API Gateway HTTP API | Contenedores (Fly.io, ECS Fargate), VM | Pago por uso real; sin servidores que administrar; escala a cero |
| 12 | Supabase solo como PostgreSQL | Supabase Auth/Data API; RDS desde el día 1 | Postgres administrado con pooler para serverless a costo fijo bajo; la Data API queda cerrada |
| 13 | Cifrado de sobre propio | Supabase Vault | La llave maestra vive fuera de la base: una fuga de la base no expone secretos; portable a KMS |

### Preguntas abiertas

1. **Número propio o número compartido.** El producto pide que cada cliente conecte sus credenciales de WhatsApp, pero el plan Pro dice "1 número de WhatsApp vinculado", que para un freelancer suena a vincular su teléfono personal a un número de Ticbo. ¿Pro usa el número compartido de Ticbo y Negocio/Despacho su número propio? El esquema soporta ambos.
2. **Proveedor de OCR**: decidir con la prueba de 200 tickets (§6).
3. **Proveedor de pagos**: Stripe, o Mercado Pago/Conekta si se quiere cobrar con OXXO y SPEI en MXN.
4. **e.firma para descarga masiva** (plan Despacho): confirmar si la función entra en el primer lanzamiento, porque define si el vault de llaves fiscales se usa desde el día 1.
5. **Aviso de privacidad (LFPDPPP)**: se guardan datos fiscales y fotos de tickets; definir retención (por ejemplo, borrar fotos a los 90 días y conservar CFDI los 5 años que exige el CFF).
