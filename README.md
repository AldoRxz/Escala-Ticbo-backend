# Ticbo · Backend

API de Ticbo: facturación CFDI 4.0 de tickets de compra por WhatsApp.
NestJS 12 sobre Fastify 5, TypeScript estricto (ESM), PostgreSQL con Drizzle ORM y Zod.
Se despliega en **AWS Lambda** (pago por uso) con la base de datos en **Supabase**; en local corre como servidor HTTP.

Diseño completo: [docs/architecture/backend-design.md](docs/architecture/backend-design.md).

## Requisitos

- Node.js 24 o superior
- Docker (para PostgreSQL local)

## Desarrollo

```bash
npm install
npm run setup:env    # crea .env con secretos locales aleatorios
npm run db:up        # PostgreSQL 18 en Docker (crea el rol ticbo_app y la base ticbo_test)
npm run db:migrate   # aplica las migraciones de drizzle/
npm run start:dev    # http://localhost:4000/api/v1/health
```

| Script | Qué hace |
|---|---|
| `npm run start:dev` | API con recarga automática |
| `npm run build` / `npm run start:prod` | Compila a `dist/` y lo ejecuta |
| `npm test` | Pruebas unitarias (Vitest) |
| `npm run test:e2e` | Pruebas e2e contra la base `ticbo_test` (requiere `npm run db:up`) |
| `npm run typecheck` / `npm run lint` | TypeScript sin emitir / oxlint con reglas de tipos |
| `npm run db:generate` | Genera una migración SQL a partir de los cambios en el esquema |
| `npm run db:studio` | Explorador de la base de datos (Drizzle Studio) |
| `npm run build:lambda` | Paquete para AWS Lambda en `dist-lambda/api` (arm64; `-- --arch=x64` para probar en local) |
| `npm run setup:env` | Crea `.env` con secretos locales aleatorios |

## Variables de entorno

Todas están documentadas en [.env.example](.env.example) y se validan al arrancar: si alguna falta o es inválida, el proceso no inicia y lista cada problema. No hay credenciales en el código.

- `DATABASE_URL` usa el rol restringido `ticbo_app` (le aplica Row-Level Security); `DATABASE_MIGRATION_URL`, el rol dueño, solo para migraciones.
- Con **Supabase** (proyecto en us-west-2): copia `.env.supabase.example` a `.env.supabase` y llena las contraseñas; `npm run db:migrate:supabase` migra y `npm run start:supabase` levanta la API local contra Supabase. `DATABASE_URL` apunta al *transaction pooler* (puerto 6543, usuario `ticbo_app.<project-ref>`), `DATABASE_MIGRATION_URL` al *session pooler* (puerto 5432, usuario `postgres.<project-ref>`), `DATABASE_SSL=true` con el certificado de Supabase en `DATABASE_SSL_CA`, y `DATABASE_POOL_MAX=1` en Lambda. Desactiva la Data API en el panel de Supabase: la API de Ticbo no la usa.
- `VAULT_KEYS` son las llaves maestras con las que se cifran los secretos de clientes; viven fuera de la base de datos.
- `API_PUBLIC_URL` es el origen por el que el navegador llega a la API: el sitio web, que reenvía `/api/*` (proxy en `next.config.ts` del frontend). Local: `http://localhost:3000`; producción: `https://escala-ticbo.vercel.app` (variables del repo en GitHub: `API_PUBLIC_URL`, `WEB_APP_URL`, `CORS_ORIGINS`).
- `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` son opcionales (en producción: `/ticbo/prod/GOOGLE_CLIENT_ID` y `/ticbo/prod/GOOGLE_CLIENT_SECRET` en SSM). En Google Cloud, las URIs de redirección autorizadas son `{API_PUBLIC_URL}/api/v1/auth/oauth/google/callback` de cada ambiente. `GET /api/v1/auth/oauth` dice qué proveedores están activos.

## API

Todas las rutas viven bajo `/api/v1`. Los errores siguen RFC 9457 (`application/problem+json`) con un `code` estable.

| Ruta | Acceso | Descripción |
|---|---|---|
| `POST /auth/register` | público | Registro con correo, contraseña (12+ caracteres) y nombre |
| `POST /auth/login` | público | Inicio de sesión |
| `POST /auth/refresh` | cookie | Rota la sesión y entrega un token de acceso nuevo |
| `POST /auth/logout` | cookie | Cierra la sesión |
| `GET /auth/oauth/google` | público | Inicia sesión con Google |
| `GET /me` | Bearer | Usuario y cuentas |
| `GET /health` · `GET /health/live` | público | Readiness (incluye PostgreSQL) y liveness |

El token de acceso llega en el cuerpo de la respuesta y dura 15 minutos: guárdalo en memoria, no en `localStorage`. El refresh token viaja solo en la cookie `httpOnly` `ticbo_rt`; desde el navegador llama a la API con `credentials: 'include'`.

La web (repo `Escala-Ticbo`) tiene las pantallas: `/iniciar-sesion`, `/crear-cuenta`, `/cuenta` y `/auth/callback`, a donde regresa Google (llama a `POST /auth/refresh` para obtener el token de acceso). Los errores de Google llegan como `/iniciar-sesion?error=<code>`.

## Estructura

```
src/
  lambda.ts                 entrada en AWS Lambda (API Gateway HTTP API)
  main.ts, app.module.ts    servidor HTTP local y composición
  bootstrap/                configuración de Fastify y del handler de Lambda
  config/                   variables de entorno validadas con Zod
  shared/                   kernel compartido: errores, ids, base de datos, HTTP
    infrastructure/database/schema/   esquema de PostgreSQL (Drizzle)
  modules/
    iam/                    identidad y acceso (implementado)
    vault/                  cifrado de secretos de clientes (implementado)
    health/                 probes de orquestación (implementado)
    fiscal/ messaging/ receipts/ invoicing/ billing/   por implementar
drizzle/                    migraciones SQL (incluye RLS, permisos y endurecimiento para Supabase)
scripts/                    setup-env y build-lambda
test/                       pruebas e2e, incluido el handler de Lambda
docs/                       arquitectura y flujo del producto
```

Cada módulo separa `domain/` (reglas puras), `application/` (casos de uso y puertos), `infrastructure/` (adaptadores) y `presentation/` (HTTP).

## Despliegue (automático)

Cada push a `main` que toque código, migraciones o infraestructura corre `.github/workflows/deploy.yml`:

1. **Pruebas**: auditoría de dependencias, typecheck, lint, unitarias y e2e contra un Postgres temporal. Si algo falla, no se despliega. Los PRs corren solo esta parte.
2. **Despliegue** en la cuenta `ticbo` (us-west-2), con OIDC y sin llaves guardadas: lee los secretos de SSM (`/ticbo/prod/*`), aplica las migraciones en Supabase, empaqueta la Lambda (arm64) y actualiza el stack `ticbo-app-prod` (`infra/template.yaml`).
3. **Smoke test**: `GET /api/v1/health` debe responder 200.

Otros workflows: `backup.yml` hace un `pg_dump` diario a S3 y Dependabot propone actualizaciones cada semana.

La base de la cuenta (rol de despliegue, permissions boundary, buckets) está en `infra/bootstrap.yaml`; se aplica a mano solo cuando ese archivo cambia:

```bash
aws cloudformation deploy --template-file infra/bootstrap.yaml --stack-name ticbo-bootstrap \
  --capabilities CAPABILITY_NAMED_IAM --profile ticbo
```

Seguridad y datos: [docs/architecture/seguridad.md](docs/architecture/seguridad.md).

Para probar el paquete como corre en AWS: `npm run build:lambda -- --arch=x64` y montar `dist-lambda/api` en la imagen `public.ecr.aws/lambda/nodejs:24`, que trae el emulador de Lambda.

El `Dockerfile` (`docker compose --profile app up --build`) corre la misma API como contenedor, como alternativa a Lambda.
