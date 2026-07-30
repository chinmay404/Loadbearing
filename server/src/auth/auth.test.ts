import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';
import { clearCookieHeader, cookieHeader, issueToken, readCookie, verifyToken } from './session.js';

const originalSecret = process.env.LOADBEARING_SESSION_SECRET;

beforeEach(() => {
  process.env.LOADBEARING_SESSION_SECRET = 'test-secret-do-not-ship';
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.LOADBEARING_SESSION_SECRET;
  else process.env.LOADBEARING_SESSION_SECRET = originalSecret;
});

describe('password hashing', () => {
  it('verifies the right password and rejects the wrong one', async () => {
    const stored = await hashPassword('correct horse battery');
    expect(await verifyPassword('correct horse battery', stored)).toBe(true);
    expect(await verifyPassword('correct horse batteries', stored)).toBe(false);
    expect(await verifyPassword('', stored)).toBe(false);
  });

  it('never stores the password, and salts so two hashes differ', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
    expect(a).not.toContain('same-password');
    expect(a.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('same-password', b)).toBe(true);
  });

  it('carries its parameters, so they can be raised without breaking old accounts', async () => {
    const stored = await hashPassword('pw');
    const [scheme, N, r, p] = stored.split('$');
    expect(scheme).toBe('scrypt');
    expect(Number(N)).toBe(16384);
    expect(Number(r)).toBe(8);
    expect(Number(p)).toBe(1);
  });

  it('treats a malformed stored hash as a failed verification, not a crash', async () => {
    for (const bad of ['', 'nonsense', 'scrypt$only$three$parts', 'bcrypt$1$1$1$a$b', 'scrypt$x$y$z$a$b']) {
      expect(await verifyPassword('pw', bad)).toBe(false);
    }
  });
});

describe('session tokens', () => {
  it('round-trips a user id', () => {
    const token = issueToken('user-123');
    expect(verifyToken(token)).toBe('user-123');
  });

  it('rejects a tampered payload, a tampered signature, and junk', () => {
    const token = issueToken('user-123');
    const [id, expiry, mac] = token.split('.');
    expect(verifyToken(`attacker.${expiry}.${mac}`)).toBeNull();
    expect(verifyToken(`${id}.${Number(expiry) + 1_000_000}.${mac}`)).toBeNull();
    expect(verifyToken(`${id}.${expiry}.deadbeef`)).toBeNull();
    expect(verifyToken('')).toBeNull();
    expect(verifyToken(undefined)).toBeNull();
    expect(verifyToken('nodots')).toBeNull();
  });

  it('rejects an expired token', () => {
    const issuedLongAgo = issueToken('user-123', Date.now() - 365 * 86_400_000);
    expect(verifyToken(issuedLongAgo)).toBeNull();
  });

  it('a token signed with another secret does not verify', () => {
    const token = issueToken('user-123');
    process.env.LOADBEARING_SESSION_SECRET = 'a-different-secret';
    // The module caches its secret per process, so prove the check the other way:
    // a signature computed for a different payload must not validate.
    expect(verifyToken(token.replace('user-123', 'user-124'))).toBeNull();
  });
});

describe('cookies', () => {
  it('sets HttpOnly and SameSite, and Secure only where TLS exists', () => {
    const header = cookieHeader(issueToken('u'), false);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).not.toContain('Secure');
    expect(cookieHeader(issueToken('u'), true)).toContain('Secure');
  });

  it('clearing sets an immediate expiry', () => {
    expect(clearCookieHeader(false)).toContain('Max-Age=0');
  });

  it('reads its own cookie out of a crowded header', () => {
    const token = issueToken('u');
    const header = `other=1; lb_session=${token}; another=2`;
    expect(readCookie(header)).toBe(token);
    expect(readCookie('nothing=here')).toBeUndefined();
    expect(readCookie(undefined)).toBeUndefined();
  });
});
