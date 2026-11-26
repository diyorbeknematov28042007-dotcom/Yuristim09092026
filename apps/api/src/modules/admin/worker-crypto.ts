const encoder = new TextEncoder();

export async function hashAdminToken(token: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const result = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(`admin:${token}`)),
  );
  return Array.from(result, (value) => value.toString(16).padStart(2, '0')).join('');
}

export function createAdminToken(): string {
  const random = crypto.getRandomValues(new Uint8Array(32));
  let raw = '';
  for (const byte of random) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
