import { createHmac, timingSafeEqual } from 'node:crypto';

/** HMAC-SHA256 hex digest of the exact raw request bytes. */
export function sign(rawBody: Buffer | string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

export function verifySignature(rawBody: Buffer | undefined, header: string | undefined, secret: string): boolean {
  if (!rawBody || !header) return false;
  const expected = Buffer.from(sign(rawBody, secret), 'hex');
  const given = Buffer.from(header.trim(), 'hex');
  // timingSafeEqual throws on length mismatch, so compare lengths first (length is not secret).
  return given.length === expected.length && timingSafeEqual(given, expected);
}
