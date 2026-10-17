/** What the bot answers in the chat, the same on Telegram and WhatsApp unless noted. */
export const CHAT_REPLIES = {
  /** Telegram: the person has not shared their number yet. */
  askContact:
    'Hola 👋 Soy el bot de facturas de Ticbo. Para mandarme tickets, primero confirma tu número con el botón «Compartir mi número».',
  shareContactButton: '📱 Compartir mi número',
  notOwnContact:
    'Comparte tu propio número con el botón «Compartir mi número», no el de otro contacto.',
  /** Telegram: the shared number is not on the bot's list. */
  notAuthorizedTelegram: (phone: string) =>
    `El número ${phone} no está autorizado para mandar tickets a esta cuenta. Pide a quien administra Ticbo que lo agregue en Canales y luego escribe /start.`,
  notAuthorizedWhatsApp:
    'Este número no está autorizado para mandar tickets a esta cuenta. Pide a quien administra Ticbo que lo agregue en Canales.',
  linked: (label: string | null) =>
    `¡Listo${label ? `, ${label}` : ''}! Ya puedes mandarme fotos de tus tickets y yo me encargo de la factura. 📸`,
  help: 'Mándame una foto de tu ticket y yo me encargo de la factura. 📸',
  received: (receiver: { rfc: string; legalName: string } | null) =>
    receiver
      ? `✅ Recibí tu ticket. Lo voy a facturar a ${receiver.legalName} (${receiver.rfc}). Te aviso por aquí cuando tenga la factura.`
      : '✅ Recibí tu ticket. Tu cuenta todavía no tiene un RFC registrado: agrégalo en Ticbo para que pueda facturarlo.',
  onlyPhotos: 'Por ahora solo leo fotos de tickets (JPG, PNG o WebP). Mándamelo como foto.',
  tooLarge: (app: 'Telegram' | 'WhatsApp') =>
    `La foto pesa más de 4 MB. Mándala como foto, no como archivo, para que ${app} la comprima.`,
  failed: 'No pude guardar tu ticket en este momento. Inténtalo de nuevo en unos minutos.',
} as const;
