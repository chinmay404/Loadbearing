// Credentials for things that are not browsers.
//
// A session here is a signed cookie with no row behind it, which is the right shape
// for a browser: no lookup, no state, and rotating the secret ends every session at
// once. It is the wrong shape for a token you paste into an agent's config on some
// other machine, because the one thing you need from such a token is the ability to
// revoke it the moment you regret it — and you cannot revoke what is not stored.
//
// So these are rows. The cost is one read per request, which is fine for a caller
// that is a program rather than a page. What is stored is the hash, never the
// secret: the table leaking is embarrassing, not catastrophic.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Storage } from '../storage/types.js';

/** `lb_<publicId>_<secret>` — the prefix makes a leaked token searchable in logs. */
export const TOKEN_PREFIX = 'lb';
const ID_BYTES = 6;
const SECRET_BYTES = 24;

/**
 * Hex, not base64url, for the two halves.
 *
 * base64url is the obvious choice and it is wrong here: its alphabet contains `_`,
 * which is the delimiter, so roughly every other minted token split into four parts
 * and failed to parse. Hex is longer and cannot collide with the separator, and a
 * credential is not the place to save twelve characters.
 */
const encode = (bytes: Buffer): string => bytes.toString('hex');

/**
 * How stale a last-used stamp may be before it is worth a write.
 *
 * "When did anything last use this token" is answered well enough by "some time in
 * the last five minutes", and an agent making forty calls in a row should not cost
 * forty writes to record forty timestamps nobody will read.
 */
const TOUCH_AFTER_MS = 5 * 60_000;

export interface MintedToken {
  id: string;
  /** The full secret. Shown once, at creation, and never recoverable. */
  secret: string;
  hash: string;
}

export function mintToken(): MintedToken {
  const id = encode(randomBytes(ID_BYTES));
  const secret = encode(randomBytes(SECRET_BYTES));
  return { id, secret: `${TOKEN_PREFIX}_${id}_${secret}`, hash: hashSecret(secret) };
}

export const hashSecret = (secret: string): string =>
  createHash('sha256').update(secret).digest('base64url');

/** Splits a presented token without trusting any part of it. */
export function parseToken(raw: string): { id: string; secret: string } | null {
  const parts = raw.split('_');
  if (parts.length !== 3) return null;
  const [prefix, id, secret] = parts as [string, string, string];
  if (prefix !== TOKEN_PREFIX || !id || !secret) return null;
  return { id, secret };
}

/** Looks like one of ours, so it should be checked as one rather than as a session. */
export const looksLikeApiToken = (raw: string | undefined): boolean =>
  Boolean(raw && raw.startsWith(`${TOKEN_PREFIX}_`));

/**
 * Resolves a presented token to the account that owns it, or null.
 *
 * The comparison is constant-time even though the id lookup already narrowed it to
 * one row: an attacker who knows a valid id and is guessing the secret is exactly
 * the case a timing leak would help, and it costs nothing to close.
 */
export async function userForToken(store: Storage, raw: string): Promise<string | null> {
  const parsed = parseToken(raw);
  if (!parsed) return null;
  const row = await store.findApiToken(parsed.id);
  if (!row) return null;

  const expected = Buffer.from(row.hash);
  const given = Buffer.from(hashSecret(parsed.secret));
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  if (staleEnoughToRecord(row.lastUsedAt)) {
    // Not awaited on purpose: an audit timestamp is not worth adding a round trip to
    // every authenticated call. A failure here loses one stamp and nothing else.
    void store.touchApiToken(parsed.id).catch(() => undefined);
  }
  return row.userId;
}

function staleEnoughToRecord(lastUsedAt: string, now = Date.now()): boolean {
  if (!lastUsedAt) return true;
  const then = Date.parse(lastUsedAt.includes('T') ? lastUsedAt : `${lastUsedAt.replace(' ', 'T')}Z`);
  return !Number.isFinite(then) || now - then > TOUCH_AFTER_MS;
}
