export const SECRET_KINDS = [
  'whatsapp_access_token',
  'whatsapp_app_secret',
  'fiel_private_key',
  'fiel_password',
  'csd_private_key',
  'csd_password',
] as const;
export type SecretKind = (typeof SECRET_KINDS)[number];

export interface SecretReference {
  accountId: string;
  kind: SecretKind;
  secretId: string;
}

/**
 * Additional authenticated data bound to every ciphertext. Copying a ciphertext
 * to another row, account or kind changes this value, so decryption fails.
 */
export function secretContext({ accountId, kind, secretId }: SecretReference): Buffer {
  return Buffer.from(`ticbo.vault.v1|${accountId}|${kind}|${secretId}`, 'utf8');
}
