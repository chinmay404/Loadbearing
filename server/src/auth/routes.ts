// Accounts. Deliberately the smallest thing that works: a username, a password,
// and a per-user API key stored in that user's settings. No email, no reset
// flow, no verification — this is a study tool, and anyone can sign up.

import { Hono } from 'hono';
import { storage } from '../storage/index.js';
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from './password.js';
import { clearCookieHeader, cookieHeader, issueToken } from './session.js';
import { requireUser, type AppEnv } from './middleware.js';

export const authRoutes = new Hono<AppEnv>();

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;

/**
 * A wrong password should cost the attacker something. scrypt already makes each
 * guess expensive; this adds a per-username cool-off after repeated failures.
 * It is per-process, so on serverless it only slows an attacker who keeps
 * hitting the same warm instance — worth having, not worth trusting alone.
 */
const failures = new Map<string, { count: number; until: number }>();
const LOCK_AFTER = 8;
const LOCK_MS = 60_000;

function lockedFor(username: string): number {
  const rec = failures.get(username);
  if (!rec || rec.count < LOCK_AFTER) return 0;
  return Math.max(0, rec.until - Date.now());
}

function noteFailure(username: string): void {
  const rec = failures.get(username) ?? { count: 0, until: 0 };
  rec.count += 1;
  rec.until = Date.now() + LOCK_MS;
  failures.set(username, rec);
}

const normalize = (raw: unknown): string => String(raw ?? '').trim().toLowerCase();

authRoutes.post('/auth/register', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { username?: string; password?: string };
  const username = normalize(body.username);
  const password = String(body.password ?? '');

  if (!USERNAME_RE.test(username)) {
    return c.json(
      {
        error: {
          code: 'bad_username',
          message: 'Pick a username of 3–32 characters: letters, digits, dot, dash or underscore.',
        },
      },
      400,
    );
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return c.json(
      {
        error: {
          code: 'weak_password',
          message: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
          hint: 'Nothing here is worth much to an attacker, but your API key is stored against this account.',
        },
      },
      400,
    );
  }

  const store = await storage();
  if (await store.getUserByUsername(username)) {
    return c.json({ error: { code: 'taken', message: 'That username is taken.' } }, 409);
  }

  const isFirst = (await store.countUsers()) === 0;
  const user = await store.createUser(username, await hashPassword(password));

  // Whatever this instance recorded before accounts existed belongs to whoever
  // sets it up — otherwise a local install loses its whole history to auth.
  let inherited = 0;
  if (isFirst) {
    inherited = await store.claimLegacyData(user.id);
    if (inherited > 0) console.log(`[loadbearing] moved ${inherited} pre-auth rows to ${username}`);
  }

  c.header('set-cookie', cookieHeader(issueToken(user.id)));
  return c.json({ username: user.username, token: issueToken(user.id), inherited }, 201);
});

authRoutes.post('/auth/login', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { username?: string; password?: string };
  const username = normalize(body.username);
  const password = String(body.password ?? '');

  const waitMs = lockedFor(username);
  if (waitMs > 0) {
    return c.json(
      {
        error: {
          code: 'too_many_attempts',
          message: `Too many failed attempts. Try again in ${Math.ceil(waitMs / 1000)}s.`,
        },
      },
      429,
    );
  }

  const store = await storage();
  const user = await store.getUserByUsername(username);
  // Same message and roughly the same work either way: a distinct "no such user"
  // reply would let anyone enumerate accounts.
  const ok = user ? await verifyPassword(password, user.passHash) : false;
  if (!user || !ok) {
    noteFailure(username);
    return c.json({ error: { code: 'bad_credentials', message: 'Wrong username or password.' } }, 401);
  }

  failures.delete(username);
  const token = issueToken(user.id);
  c.header('set-cookie', cookieHeader(token));
  return c.json({ username: user.username, token });
});

authRoutes.post('/auth/logout', (c) => {
  c.header('set-cookie', clearCookieHeader());
  return c.json({ ok: true });
});

authRoutes.get('/auth/me', requireUser, (c) => c.json({ username: c.get('username') }));
