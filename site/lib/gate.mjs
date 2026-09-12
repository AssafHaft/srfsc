// The code screen in front of the page. A curtain, not a lock: the site and its data are public,
// so this only keeps out people who open the link. Only the code's SHA-256 hash is stored (config.js).
export const CODE_LENGTH = 6;

/** Whatever was typed → the digits 0–9 only, at most CODE_LENGTH of them. */
export const codeFrom = value => String(value).replace(/[^0-9]/g, '').slice(0, CODE_LENGTH);

/** Hex SHA-256 of a string, with the built-in Web Crypto (browsers and Node 20+). */
export async function sha256Hex(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** True when a full-length code hashes to `hash`. */
export const checkCode = async (code, hash) => code.length === CODE_LENGTH && (await sha256Hex(code)) === hash;
