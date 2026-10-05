import { describe, expect, it } from 'vitest';
import { newId } from './id.js';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newId', () => {
  it('produces RFC 9562 version 7 UUIDs', () => {
    expect(newId()).toMatch(UUID_V7);
  });

  it('encodes the timestamp in the first 48 bits', () => {
    const now = Date.UTC(2026, 9, 4, 12, 0, 0);
    const id = newId(now);

    expect(parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBe(now);
  });

  it('sorts by creation time', () => {
    const earlier = newId(1_000);
    const later = newId(2_000);

    expect([later, earlier].sort()).toEqual([earlier, later]);
  });
});
