// Random tokens and hashes (Web Crypto, available in Workers).

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 256 random bits, URL safe. */
export function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** PKCE S256 challenge for a verifier. */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function aesKey(secret: string): Promise<CryptoKey> {
  const raw = fromBase64(secret);
  if (raw.length !== 32) throw new Error('ACCOUNT_ENC_KEY must be 32 bytes, base64');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** AES-256-GCM; `context` (e.g. user and record id) is bound in, so a value can't be moved to another record. */
export async function encrypt(secret: string, plain: string, context: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(context) },
    await aesKey(secret),
    new TextEncoder().encode(plain),
  );
  return `v1.${base64url(iv)}.${base64url(new Uint8Array(data))}`;
}

export async function decrypt(secret: string, sealed: string, context: string): Promise<string> {
  const [v, iv, data] = sealed.split('.');
  if (v !== 'v1' || !iv || !data) throw new Error('Unknown encrypted value');
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(iv), additionalData: new TextEncoder().encode(context) },
    await aesKey(secret),
    fromBase64(data),
  );
  return new TextDecoder().decode(plain);
}
