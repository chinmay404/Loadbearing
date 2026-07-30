import type { MiddlewareHandler } from 'hono';
import { storage } from '../storage/index.js';
import { readCookie, verifyToken } from './session.js';

/** Every authenticated route can read these off the context. */
export type AppEnv = {
  Variables: {
    userId: string;
    username: string;
  };
};

/** Extracts a session token from the cookie, or an `Authorization: Bearer` header. */
export function tokenFrom(c: { req: { header: (name: string) => string | undefined } }): string | undefined {
  const auth = c.req.header('authorization');
  if (auth && /^bearer /i.test(auth)) return auth.slice(7).trim();
  return readCookie(c.req.header('cookie'));
}

/**
 * Resolves the session if there is one and lets the request through either way.
 * Used on routes that work signed out (health, the problem bank).
 */
export const attachUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const userId = verifyToken(tokenFrom(c));
  if (userId) {
    const user = await (await storage()).getUserById(userId);
    if (user) {
      c.set('userId', user.id);
      c.set('username', user.username);
    }
  }
  await next();
};

/** Rejects the request unless a valid session names a user that still exists. */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const userId = verifyToken(tokenFrom(c));
  if (!userId) {
    return c.json(
      {
        error: {
          code: 'unauthorized',
          message: 'Sign in to continue.',
          hint: 'Your session expired or was never started — the sign-in panel is on the left.',
        },
      },
      401,
    );
  }
  const user = await (await storage()).getUserById(userId);
  if (!user) {
    return c.json(
      { error: { code: 'unauthorized', message: 'That account no longer exists.' } },
      401,
    );
  }
  c.set('userId', user.id);
  c.set('username', user.username);
  await next();
};
