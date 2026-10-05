# Flujo del bot de WhatsApp

Qué hace Ticbo desde que el cliente se da de alta hasta que recibe su factura. El diseño técnico está en [backend-design.md](../architecture/backend-design.md#6-pipeline-asíncrono-de-la-foto-al-cfdi).

## Pedido original

> Lo que tiene que hacer es que ellos pongan las credenciales de WhatsApp API y levantemos como un bot que mande mensajes por esa API, reciba la foto del ticket y, con la información que guardaron, por ejemplo un ticket de Starbucks, busque la página donde tiene que hacer la factura y va y hace la factura con toda la información, y ya solo regresa el PDF y el XML.

En una frase: **el cliente manda la foto, Ticbo hace el trámite en el portal del comercio y le regresa el CFDI.**

---

## 1. Configuración inicial (una sola vez)

En la app web (`app.ticbo.com`), el dueño de la cuenta:

1. **Crea su cuenta** con correo y contraseña o con Google.
2. **Registra uno o más perfiles fiscales** (los datos del receptor que piden todos los portales):
   - RFC
   - Razón social (exactamente como en la Constancia de Situación Fiscal)
   - Régimen fiscal
   - Código postal del domicilio fiscal
   - Uso de CFDI por defecto (por ejemplo, G03 Gastos en general)

   Ticbo le asigna a cada perfil un correo propio (por ejemplo, `abc010101xyz@facturas.ticbo.com`). Ese es el correo que se captura en los portales, para que el XML y el PDF le lleguen a Ticbo.
3. **Conecta su WhatsApp Business**: captura las credenciales de su app de Meta (*phone number id*, *WhatsApp Business Account id*, token de acceso y *app secret*). Ticbo las guarda cifradas y le muestra la URL del webhook y el *verify token* que debe pegar en Meta.
4. **Autoriza los teléfonos** que pueden mandar tickets (él mismo, sus empleados en campo) y elige el RFC por defecto de cada uno.

## 2. Conversación típica

```
Empleado → [foto del ticket de Starbucks]

Ticbo    → Recibí tu ticket de Starbucks del 3 de octubre por $185.00.
           Lo facturo a COMERCIALIZADORA ABC (ABC010101XYZ), uso G03.
           Te aviso en cuanto llegue.

           (unos minutos después)

Ticbo    → ✅ Listo. Factura de Starbucks por $185.00
           Folio fiscal 5F3A…-…-9C21
           [ABC010101XYZ_5F3A.xml]
           [ABC010101XYZ_5F3A.pdf]
```

Si el teléfono tiene varios RFCs disponibles, Ticbo pregunta antes de facturar:

```
Ticbo    → ¿A qué RFC lo facturo?
           1. COMERCIALIZADORA ABC (ABC010101XYZ)
           2. SERVICIOS XYZ (XYZ020202ABC)
Empleado → 2
```

## 3. Qué pasa por dentro

| # | Paso | Estado del ticket |
|---|---|---|
| 1 | Llega la foto por el webhook de WhatsApp. Ticbo verifica que el mensaje viene de Meta y que el teléfono está autorizado, guarda el ticket y responde a Meta de inmediato. | `received` |
| 2 | Se descarga la imagen, se guarda en R2 y se leen los datos del ticket: comercio, RFC emisor, folio o número de ticket, sucursal, fecha y total. | `extracting` |
| 3 | Se busca al comercio en el catálogo de portales y se elige el RFC receptor. Se confirma al usuario lo que se va a facturar. | `requesting_invoice` |
| 4 | Un navegador automatizado entra al portal del comercio (por ejemplo, el de Starbucks), captura los datos del ticket y del perfil fiscal, y pide la factura con el correo de Ticbo del perfil. | `requesting_invoice` |
| 5 | Se espera el correo del comercio con el XML y el PDF (o se descargan del portal si lo permite). | `awaiting_cfdi` |
| 6 | Se valida el XML: que el receptor y el total coincidan, que el folio fiscal esté vigente en el SAT y que el emisor no esté en la lista 69-B. | `awaiting_cfdi` |
| 7 | Se mandan el XML y el PDF por WhatsApp y quedan en el buzón web. | `invoiced` |

Cualquier paso que no se puede resolver solo termina en `needs_review` (lo revisa una persona desde el panel) o en `failed` con un mensaje claro al usuario.

## 4. Casos especiales

| Situación | Qué hace Ticbo |
|---|---|
| Foto borrosa o incompleta | Pide otra foto e indica qué no se lee (folio, total…). |
| Comercio sin portal soportado | Avisa que todavía no factura ese comercio y registra la solicitud; los comercios más pedidos son los siguientes en recibir adaptador. |
| Ticket fuera de plazo | Muchos portales solo facturan dentro del mes de compra. Si ya venció, avisa en lugar de intentar. |
| Ticket ya facturado | El portal lo indica; Ticbo intenta recuperar el CFDI existente o avisa al usuario. |
| Portal caído, cambiado o con CAPTCHA | Reintenta con espera creciente; si sigue fallando, pasa a revisión humana y avisa del retraso. |
| CFDI con datos incorrectos | Si el receptor o el total no coinciden, no lo entrega como válido y lo manda a revisión. |
| Emisor en la lista 69-B (EFOS) | Entrega el CFDI con una advertencia: deducirlo es riesgoso. |
| Teléfono no autorizado | Responde que el número no está registrado y no procesa nada. |
| Límite del plan alcanzado | Avisa al usuario y al dueño de la cuenta; no factura hasta el siguiente periodo o un cambio de plan. |
| La factura tarda más de 24 horas | WhatsApp solo permite mensajes libres 24 horas después del último mensaje del usuario; la entrega se hace con una plantilla aprobada de "tu factura está lista". |

## 5. Lo que Ticbo mantiene por cada comercio

El catálogo de comercios (`merchants`) es compartido por todos los clientes:

- Nombre y RFC emisor
- URL del portal de facturación
- Adaptador que sabe llenarlo (por ejemplo, `starbucks-mx`)
- Campos del ticket que pide el portal (folio, sucursal, total, fecha…)
- Días de vigencia para facturar
- Estado: `active`, `degraded` (falló la prueba diaria) o `unsupported`

## 6. Fuera de la primera versión

- Emitir CFDI propios del cliente (requeriría su CSD).
- Descarga masiva desde el SAT con e.firma (función del plan Despacho; se activa por separado).
- Tickets en PDF o reenviados por correo; la primera versión recibe fotos por WhatsApp y archivos desde la web.
- Conexión de WhatsApp con *Embedded Signup* de Meta (conectar el número con unos clics en lugar de copiar credenciales).
