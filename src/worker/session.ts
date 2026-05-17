const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export async function createSessionCookie(secret: string, now = new Date()): Promise<string> {
  const expires = Math.floor(now.getTime() / 1000) + SESSION_TTL_SECONDS;
  const payload = `${expires}.${crypto.randomUUID()}`;
  const signature = await sign(payload, secret);
  const value = btoaUrl(`${payload}.${signature}`);
  return `session=${value}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

export async function verifySessionCookie(cookieHeader: string | null, secret: string, now = new Date()): Promise<boolean> {
  const value = getCookie(cookieHeader, "session");
  if (!value) return false;

  const decoded = atobUrl(value);
  const parts = decoded.split(".");
  if (parts.length !== 3) return false;

  const [expiresRaw, nonce, signature] = parts as [string, string, string];
  const expires = Number(expiresRaw);
  if (!Number.isFinite(expires) || expires * 1000 <= now.getTime()) return false;

  const expected = await sign(`${expiresRaw}.${nonce}`, secret);
  return timingSafeEqual(signature, expected);
}

export function clearSessionCookie(): string {
  return "session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax";
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return btoaUrl(String.fromCharCode(...new Uint8Array(signature)));
}

function getCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(";").map((part) => part.trim());
  const cookie = cookies.find((part) => part.startsWith(`${name}=`));
  return cookie ? cookie.slice(name.length + 1) : null;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}

function btoaUrl(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function atobUrl(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return atob(padded);
}
