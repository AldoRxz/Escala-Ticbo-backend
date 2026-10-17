import { describe, expect, it } from 'vitest';
import { botLink, parseBotToken } from './telegram.js';

describe('parseBotToken', () => {
  it('reads the bot id from a @BotFather token', () => {
    expect(parseBotToken(' 7012345678:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw\n')).toEqual({
      token: '7012345678:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw',
      botUserId: 7012345678,
    });
  });

  it('rejects anything else', () => {
    for (const input of [
      '',
      'AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw',
      '7012345678:short',
      '70:AAH/qTcv',
    ]) {
      expect(parseBotToken(input)).toBeNull();
    }
  });
});

describe('botLink', () => {
  it('opens a chat with the bot', () => {
    expect(botLink('AndinaFacturasBot')).toBe('https://t.me/AndinaFacturasBot');
  });
});
