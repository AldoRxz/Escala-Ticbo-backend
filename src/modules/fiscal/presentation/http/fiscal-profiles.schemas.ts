import { z } from 'zod';
import { LEGAL_NAME_MAX_LENGTH, validateFiscalData } from '../../domain/fiscal-profile.js';

// Hard caps on raw input size; the domain rules decide what is valid.
const field = (max: number) => z.string().trim().min(1).max(max);

// Optional: null or "" means no suggested use (the bot asks for each receipt).
const optionalCfdiUse = z
  .string()
  .trim()
  .max(4)
  .nullable()
  .optional()
  .transform((value) => (value === '' ? null : value));

const fiscalData = {
  rfc: field(20),
  legalName: field(LEGAL_NAME_MAX_LENGTH),
  taxRegime: field(3),
  postalCode: field(5),
};

/** Full SAT validation up front, so the form can mark every field at once. */
export const createFiscalProfileBodySchema = z
  .strictObject({ ...fiscalData, defaultCfdiUse: optionalCfdiUse })
  .superRefine((body, ctx) => {
    const result = validateFiscalData({ ...body, defaultCfdiUse: body.defaultCfdiUse ?? null });
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
export type CreateFiscalProfileBody = z.infer<typeof createFiscalProfileBodySchema>;

// The RFC is not editable; rules that depend on it are checked by the use case.
export const updateFiscalProfileBodySchema = z
  .strictObject({
    legalName: fiscalData.legalName.optional(),
    taxRegime: fiscalData.taxRegime.optional(),
    postalCode: fiscalData.postalCode.optional(),
    defaultCfdiUse: optionalCfdiUse,
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Send at least one field to change.',
  });
export type UpdateFiscalProfileBody = z.infer<typeof updateFiscalProfileBodySchema>;

export const fiscalProfileIdSchema = z.uuid();
