import { describe, expect, it } from 'vitest';
import { detectImageType, receiptImageKey } from './receipt.js';

describe('detectImageType', () => {
  it('recognizes JPEG, PNG and WebP by their first bytes', () => {
    expect(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))?.extension).toBe('jpg');
    expect(
      detectImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]))
        ?.contentType,
    ).toBe('image/png');
    expect(detectImageType(Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ', 'latin1'))).toEqual({
      extension: 'webp',
      contentType: 'image/webp',
    });
  });

  it('rejects anything else, whatever it claims to be', () => {
    expect(detectImageType(Buffer.from('%PDF-1.7'))).toBeNull();
    expect(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
  });
});

describe('receiptImageKey', () => {
  it('keeps every file under its account', () => {
    expect(receiptImageKey('acc-1', 'r-1', { extension: 'jpg', contentType: 'image/jpeg' })).toBe(
      'accounts/acc-1/receipts/r-1.jpg',
    );
  });
});
