// Sessions as signed cookies rather than rows in a table.
//
// The reason is the deployment target: a serverless function has no memory
// between requests, so a server-side session store would mean a database read on
// every single call. A cookie carrying `userId.expiry.hmac` needs no read at all
// and still cannot be forged without the secret. The cost is that a session
// cannot be revoked before it expires — acceptable for a personal learning tool,
// and rotating LOADBEARING_SESSION_SECRET invalidates every session at once.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SESSION_DAYS = 30;
export const COOKIE_NAME = 'lb_session';

/**
 * A missing secret in production would silently mean forgeable sessions, so it is
 * a hard failure there.
 *
 * Local dev generates one and keeps it in a gitignored file next to the database.
 * A per-process secret would be simpler, but the dev server restarts on every file
 * save, and being logged out mid-edit teaches you to distrust the login rather
 * than the code you just changed.
 */
const SECRET_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data', '.session-secret');

let cachedSecret: string | null = null;
function secret(): string {
  if (cachedSecret) return cachedSecret;
  const fromEnv = process.env.LOADBEARING_SESSION_SECRET?.trim();
  if (fromEnv) {
    cachedSecret = fromEnv;
    return cachedSecret;
  }
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
    throw new Error(
      'LOADBEARING_SESSION_SECRET is required in production. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  cachedSecret = devSecret();
  return cachedSecret;
}

function devSecret(): string {
  try {
    if (existsSync(SECRET_FILE)) {
      const stored = readFileSync(SECRET_FILE, 'utf8').trim();
      if (stored.length >= 32) return stored;
    }
    const fresh = randomBytes(32).toString('hex');
    mkdirSync(dirname(SECRET_FILE), { recursive: true });
    writeFileSync(SECRET_FILE, fresh, 'utf8');
    console.log(`[loadbearing] generated a development session secret in ${SECRET_FILE}`);
    return fresh;
  } catch {
    // Read-only checkout, or no filesystem: fall back to per-process.
    console.log('[loadbearing] using a per-process session secret (logins end on restart)');
    return randomBytes(32).toString('hex');
  }
}

const sign = (payload: string): string =>
  createHmac('sha256', secret()).update(payload).digest('base64url');

/**
 * Sign an arbitrary payload with the same secret, as `payload.mac`.
 *
 * Used by the OAuth provider for values that must survive a round trip through a
 * client without being stored here — a registered client's redirect URIs, an
 * authorization code. On a serverless host that is the difference between two more
 * tables with expiry sweeps and no tables at all, and rotating the secret
 * invalidates every one of them at once, which is the behaviour you want anyway.
 */
export function signPayload(payload: string): string {
  return `${payload}.${sign(payload)}`;
}

/** The payload back, or null if it was not signed by us. */
export function verifyPayload(signed: string | undefined): string | null {
  if (!signed) return null;
  const cut = signed.lastIndexOf('.');
  if (cut <= 0) return null;
  const payload = signed.slice(0, cut);
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signed.slice(cut + 1));
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return payload;
}

/** `userId.expiresAtMs.hmac` — opaque to the client, verifiable without a lookup. */
export function issueToken(userId: string, now = Date.now()): string {
  const expires = now + SESSION_DAYS * 86_400_000;
  const payload = `${userId}.${expires}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token: string | undefined, now = Date.now()): string | null {
  if (!token) return null;
  const idx = token.lastIndexOf('.');
  if (idx <= 0) return null;
  const payload = token.slice(0, idx);
  const mac = token.slice(idx + 1);

  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  const dot = payload.lastIndexOf('.');
  if (dot <= 0) return null;
  const userId = payload.slice(0, dot);
  const expires = Number(payload.slice(dot + 1));
  if (!Number.isFinite(expires) || expires < now) return null;
  return userId;
}

/**
 * SameSite=Lax keeps the cookie on normal navigation but off cross-site POSTs,
 * which is the CSRF protection here. Secure is set only where TLS exists, or a
 * localhost browser would refuse to store it.
 */
export function cookieHeader(token: string, secure = isSecureDeploy()): string {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_DAYS * 86_400}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookieHeader(secure = isSecureDeploy()): string {
  const parts = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function isSecureDeploy(): boolean {
  return Boolean(process.env.VERCEL) || process.env.NODE_ENV === 'production';
}

/** Reads one cookie out of a raw Cookie header. */
export function readCookie(header: string | undefined, name = COOKIE_NAME): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}
