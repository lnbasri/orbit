// Crockford base32 alphabet: no I, L, O, U. Every character is valid in QR "Alphanumeric" mode,
// which keeps the QR code small (version 2) and easy to scan.
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function newId(): string {
  return crypto.randomUUID();
}

/**
 * Opaque ticket code encoded in the participant's QR.
 * 128 bits of randomness, 26 characters. It is NOT derived from any personal data or database id,
 * so the QR on its own reveals nothing; only authorised staff can resolve it to a participant.
 */
export function newTicketToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31];
  return out;
}

export const TICKET_TOKEN_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
