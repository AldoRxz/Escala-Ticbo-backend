import { z } from 'zod';
import { SENDER_LABEL_MAX_LENGTH } from '../../domain/sender.js';
import { parseBotToken } from '../../domain/telegram.js';

export const connectBotBodySchema = z.strictObject({
  token: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .refine((token) => parseBotToken(token) !== null, {
      message: 'Paste the whole token @BotFather gave you.',
      params: { code: 'invalid_bot_token' },
    }),
});
export type ConnectBotBody = z.infer<typeof connectBotBodySchema>;

const label = z
  .string()
  .max(SENDER_LABEL_MAX_LENGTH * 2)
  .nullable()
  .optional();
const defaultFiscalProfileId = z.uuid().nullable().optional();

export const addTelegramSenderBodySchema = z.strictObject({
  phone: z.string().trim().min(1).max(30),
  label,
  defaultFiscalProfileId,
});
export type AddTelegramSenderBody = z.infer<typeof addTelegramSenderBodySchema>;

export const updateTelegramSenderBodySchema = z
  .strictObject({ label, defaultFiscalProfileId })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Send at least one field to change.',
  });
export type UpdateTelegramSenderBody = z.infer<typeof updateTelegramSenderBodySchema>;
