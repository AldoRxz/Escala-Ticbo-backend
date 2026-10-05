# Ticbo · Backend

API de Ticbo: facturación CFDI 4.0 de tickets de compra por WhatsApp.
NestJS 12 sobre Fastify 5, TypeScript estricto (ESM), PostgreSQL 18 con Drizzle ORM y Zod.

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

Para probar la imagen de producción con la base local: `docker compose --profile app up --build`.

## Variables de entorno

Todas están documentadas en [.env.example](.env.example) y se validan al arrancar: si alguna falta o es inválida, el proceso no inicia y lista cada problema. No hay credenciales en el código.

- `DATABASE_URL` usa el rol restringido `ticbo_app` (le aplica Row-Level Security); `DATABASE_MIGRATION_URL`, el rol dueño, solo para migraciones.
- `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` son opcionales. En Google Cloud, la URI de redirección autorizada es `{API_PUBLIC_URL}/api/v1/auth/oauth/google/callback`.

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

La app web debe tener dos rutas para Google: `/auth/callback` (al llegar, llamar a `POST /auth/refresh` para obtener el token de acceso) y `/login?error=<code>` para los errores.

## Estructura

```
src/
  main.ts, app.module.ts    arranque y composición
  bootstrap/                configuración de Fastify (compartida con las pruebas e2e)
  config/                   variables de entorno validadas con Zod
  shared/                   kernel compartido: errores, ids, base de datos, HTTP
    infrastructure/database/schema/   esquema de PostgreSQL (Drizzle)
  modules/
    iam/                    identidad y acceso (implementado)
    health/                 probes de orquestación (implementado)
    fiscal/ vault/ messaging/ receipts/ invoicing/ billing/   por implementar
drizzle/                    migraciones SQL (incluye RLS y permisos)
test/                       pruebas e2e
docs/                       arquitectura y flujo del producto
```

Cada módulo separa `domain/` (reglas puras), `application/` (casos de uso y puertos), `infrastructure/` (adaptadores) y `presentation/` (HTTP).

## Despliegue

1. `docker build --build-arg APP_VERSION=<sha> -t ticbo-api .`
2. Migraciones como paso previo: `node dist/shared/infrastructure/database/migrate.js` con `DATABASE_MIGRATION_URL`.
3. Desplegar con `NODE_ENV=production`, `API_PUBLIC_URL` en https y `TRUST_PROXY=true` detrás de Cloudflare. El orquestador usa `/api/v1/health` (readiness) y `/api/v1/health/live` (liveness).
