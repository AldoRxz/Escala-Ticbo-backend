export const SENDER_LABEL_MAX_LENGTH = 80;

/** Trims the label; an empty one means "no label". */
export function normalizeSenderLabel(input: string | null | undefined): string | null {
  const label = input?.trim().replace(/\s+/g, ' ') ?? '';
  return label === '' ? null : label.slice(0, SENDER_LABEL_MAX_LENGTH);
}
