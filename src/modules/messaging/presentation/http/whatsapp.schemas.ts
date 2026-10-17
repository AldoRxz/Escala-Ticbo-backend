import { z } from 'zod';
import { SENDER_LABEL_MAX_LENGTH } from '../../domain/sender.js';
import { validateCredentials } from '../../domain/whatsapp.js';

// Hard caps on raw input size; the domain rules decide what is valid.
const text = (max: number) => z.string().trim().min(1).max(max);

/** Every field checked up front, so the form can mark each wrong one. */
export const connectChannelBodySchema = z
  .strictObject({
    phoneNumberId: text(40),
    businessAccountId: text(40),
    displayPhoneNumber: text(30),
    accessToken: text(2048),
    appSecret: text(64),
  })
  .superRefine((body, ctx) => {
    const result = validateCredentials(body);
    if (!result.ok) {
      for (const issue of result.issues) {
        ctx.addIssue({
          code: 'custom',
          path: [issue.path],
          message: issue.message,
          params: { code: issue.code },
        });
      }
    }
  });
export type ConnectChannelBody = z.infer<typeof connectChannelBodySchema>;

const label = z
  .string()
  .max(SENDER_LABEL_MAX_LENGTH * 2)
  .nullable()
  .optional();
const defaultFiscalProfileId = z.uuid().nullable().optional();

export const addSenderBodySchema = z.strictObject({
  waId: text(30),
  label,
  defaultFiscalProfileId,
});
export type AddSenderBody = z.infer<typeof addSenderBodySchema>;

export const updateSenderBodySchema = z
  .strictObject({ label, defaultFiscalProfileId })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Send at least one field to change.',
  });
export type UpdateSenderBody = z.infer<typeof updateSenderBodySchema>;

export const idSchema = z.uuid();

/** Query Meta sends to verify a webhook subscription. */
export const webhookVerificationQuerySchema = z.object({
  'hub.mode': z.string().max(32).optional(),
  'hub.verify_token': z.string().max(256).optional(),
  'hub.challenge': z.string().max(256).optional(),
});
export type WebhookVerificationQuery = z.infer<typeof webhookVerificationQuerySchema>;
