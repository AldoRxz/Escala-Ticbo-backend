# Seguridad y protección de datos

Estado al 11 de octubre de 2026. Diseño general en [backend-design.md](./backend-design.md).

## Controles implementados

### Identidad y sesiones

| Control | Detalle |
|---|---|
| Contraseñas | Argon2id (19 MiB, 2 pasadas), 12 a 128 caracteres, normalización NFKC, rehash automático si cambia la política |
| Login sin enumeración | Correo inexistente y contraseña incorrecta responden igual tras el mismo trabajo de hash |
| Fuerza bruta | 5 intentos fallidos en 15 min bloquean el correo 15 min. El contador vive en Postgres (`auth_throttles`), así que funciona entre instancias de Lambda; guarda un hash del correo, no el correo, y aplica igual a correos que no existen |
| Sesiones | Access token de 15 min solo en memoria; refresh token opaco en cookie `httpOnly`, `Secure`, `SameSite=Strict` y limitada a `/api/v1/auth`; rotación en cada uso con detección de reúso (revoca la familia entera) |
| Google | OIDC con PKCE, `state` y `nonce`; defensa contra robo de cuenta por pre-registro |
| Rutas | Guard global: todo exige token salvo lo marcado `@Public()` |

### Datos

| Control | Detalle |
|---|---|
| Aislamiento entre clientes | Row-Level Security en las 15 tablas. La API usa `ticbo_app`, que no es dueño de las tablas ni puede saltarse RLS; los datos de cliente solo se ven dentro de una transacción con su `account_id`, y sin él no se ve nada |
| Integridad entre clientes | Llaves foráneas compuestas con `account_id`: una fila no puede apuntar a datos de otro cliente |
| Supabase | Data API apagada; `anon` y `authenticated` sin ningún permiso (migración `0002`) |
| Conexión | TLS verificado contra la raíz de Supabase (`certs/supabase-root-2021.crt`); `statement_timeout` de 10 s |
| Secretos de clientes | Cifrado de sobre AES-256-GCM, llave maestra fuera de la base (`VAULT_KEYS` en SSM; KMS después); el texto cifrado queda atado a su cuenta y tipo |
| Respaldos | `pg_dump` diario a S3 (`ticbo-db-backups-*`): bucket privado, cifrado, versionado, 35 días. El rol del respaldo solo puede subir archivos; no puede leer ni borrar |
| Logs | Sin query strings (códigos OAuth), sin cuerpos de petición y con los parámetros SQL redactados (correos, hashes). Retención de 14 días |

### Infraestructura (cuenta `ticbo`, us-west-2)

| Control | Detalle |
|---|---|
| Sin llaves de AWS | GitHub Actions entra por OIDC; el rol de despliegue solo acepta la rama `main` de este repo |
| Mínimo privilegio | El despliegue pasa por `ticbo-cloudformation-exec`, que solo toca recursos `ticbo-app-*` y no puede modificar los roles de despliegue |
| Permissions boundary | Todo rol que creen los stacks queda limitado por `ticbo-app-workload-boundary` (logs, SSM, SQS, KMS) aunque la plantilla le asigne más |
| Secretos de la plataforma | SSM Parameter Store `SecureString` (`/ticbo/prod/*`); el pipeline los inyecta enmascarados |
| Costos | HTTP API con límite de 25 peticiones/s (ráfaga 50); alerta de presupuesto de 4 USD al mes |

### Código y cadena de suministro

| Control | Detalle |
|---|---|
| Repo público | Historial revisado sin secretos; secret scanning y push protection de GitHub activos |
| Dependencias | `npm audit` de producción en cada ejecución; alertas y PRs semanales de Dependabot |
| GitHub Actions | Acciones fijadas a un commit (no a etiquetas movibles); `persist-credentials: false` |
| Puerta de calidad | typecheck, lint, 79 pruebas unitarias y 32 e2e antes de cualquier despliegue |

## Pendientes que dependen de ti

1. **Rotar la contraseña de `postgres` en Supabase** (Database → Settings → Reset database password): la actual quedó escrita en un chat. Después hay que actualizar `/ticbo/prod/DATABASE_MIGRATION_URL` en SSM y `.env.supabase`.
2. **Supabase → Database → SSL Configuration → Enforce SSL**, para rechazar cualquier conexión sin TLS. Todas las nuestras ya usan TLS.
3. **MFA** en el usuario raíz de la cuenta principal de AWS, en tu usuario de IAM Identity Center y en tu cuenta de GitHub.
4. **Dominio propio.** Hoy el sitio en Vercel reenvía `/api/*` a la API, así que la cookie de sesión es del mismo sitio y el login funciona sin dominio. Con dominio: canónico sin www, la API detrás del mismo proxy y el buzón de facturas en Cloudflare Email Routing.
5. **Aviso de privacidad y términos** (LFPDPPP) antes de recibir clientes reales; definir la retención de fotos de tickets.
6. **Buzón `ticbomx@gmail.com`**: verificación en dos pasos, contraseña única y correo/teléfono de recuperación, sin usarlo para nada más. Recibirá facturas con datos fiscales de todos los clientes. Cuando se construya el módulo de facturación, generar una contraseña de aplicación y guardarla en SSM como `/ticbo/prod/INVOICE_MAILBOX_PASSWORD` (`SecureString`), nunca en el chat.

## Riesgos aceptados por ahora

| Riesgo | Por qué se acepta | Cuándo revisarlo |
|---|---|---|
| El registro responde `409` si el correo ya existe | Usabilidad; el límite de la API frena barridos masivos | Al tener verificación de correo |
| Un atacante puede bloquear 15 min el login de un correo ajeno | Es el costo de frenar la fuerza bruta sin estado por IP | Si aparece abuso: CAPTCHA tras 3 fallos |
| No hay límite por IP | En Lambda no hay memoria compartida; el límite global está en API Gateway | Con Cloudflare delante (regla de rate limit gratuita) |
| El access token no se revoca antes de 15 min | Verificarlo sin base de datos es lo que mantiene barata cada petición | Si se necesita cierre de sesión inmediato |
| Un push a `main` despliega a producción | Hoy hay un solo desarrollador | Al sumar personas: protección de rama con revisión y checks obligatorios |
| Los secretos se ven en la consola de Lambda para administradores | Solo los administradores de la cuenta tienen acceso | Al mover el vault a KMS |
| El buzón de facturas depende de una contraseña de aplicación de Gmail con acceso a todo el buzón | Funciona hoy sin dominio ni costo; la cuenta se usa solo para esto | Al tener dominio (Email Routing + SES), o antes si Google retira las contraseñas de aplicación |
