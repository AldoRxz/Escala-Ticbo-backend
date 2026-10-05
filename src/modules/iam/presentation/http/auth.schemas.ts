import { z } from 'zod';
import { EMAIL_MAX_LENGTH } from '../../domain/email.js';
import { PASSWORD_MAX_LENGTH, assertAcceptablePassword } from '../../domain/password.js';
import { FULL_NAME_MAX_LENGTH } from '../../domain/user.js';

// Hard cap on raw input size; the domain policy decides what is acceptable.
const MAX_PASSWORD_INPUT = PASSWORD_MAX_LENGTH * 4;

const newPassword = z
  .string()
  .max(MAX_PASSWORD_INPUT)
  .superRefine((value, ctx) => {
    try {
      assertAcceptablePassword(value);
    } catch (error) {
      ctx.addIssue({ code: 'custom', message: (error as Error).message });
    }
  });

export const registerBodySchema = z.strictObject({
  email: z.string().trim().max(EMAIL_MAX_LENGTH).pipe(z.email()),
  password: newPassword,
  fullName: z.string().trim().min(1).max(FULL_NAME_MAX_LENGTH),
});
export type RegisterBody = z.infer<typeof registerBodySchema>;

export const loginBodySchema = z.strictObject({
  email: z.string().trim().min(1).max(EMAIL_MAX_LENGTH),
  password: z.string().min(1).max(MAX_PASSWORD_INPUT),
});
export type LoginBody = z.infer<typeof loginBodySchema>;

/** Query string Google (or another provider) sends back to the callback. */
export const oauthCallbackQuerySchema = z.object({
  code: z.string().min(1).max(2048).optional(),
  state: z.string().min(1).max(512).optional(),
  error: z.string().max(256).optional(),
});
