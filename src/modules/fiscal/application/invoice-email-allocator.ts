import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';

export abstract class InvoiceMailboxSettings {
  /** Ticbo's invoice inbox, e.g. ticbomx@gmail.com. */
  abstract readonly address: string;
}

// Lowercase letters and digits without look-alikes (0/o, 1/l/i): people
// sometimes copy the alias into a portal by hand.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const KEY_LENGTH = 8;

/**
 * A plus-address alias of the invoice inbox for each fiscal profile, such as
 * `ticbomx+k7m3p9q2@gmail.com`. The key is random, not the RFC: the alias is
 * typed into third-party portals and should not reveal or guess the receiver.
 */
@Injectable()
export class InvoiceEmailAllocator {
  constructor(private readonly settings: InvoiceMailboxSettings) {}

  next(): string {
    const at = this.settings.address.lastIndexOf('@');
    const local = this.settings.address.slice(0, at);
    const domain = this.settings.address.slice(at + 1);
    let key = '';
    for (let i = 0; i < KEY_LENGTH; i++) {
      key += ALPHABET[randomInt(ALPHABET.length)];
    }
    return `${local}+${key}@${domain}`;
  }
}
