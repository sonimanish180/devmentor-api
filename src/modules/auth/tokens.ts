import jwt from 'jsonwebtoken';
import { randomBytes, createHash } from 'node:crypto';
import { env } from '../../config/env';

/**
 * Two-token auth:
 *  - ACCESS token: a short-lived signed JWT the client sends on every request.
 *    Stateless — verified by signature, no DB lookup.
 *  - REFRESH token: a long-lived OPAQUE random string (NOT a JWT). We store only
 *    its sha256 hash in the DB, so a database leak can't be used to mint access
 *    tokens, and we can revoke/rotate it (Phase 3.4).
 */

export type Role = 'USER' | 'ADMIN';

export interface AccessTokenPayload {
  sub: string; // user id
  role: Role;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
  if (
    typeof decoded === 'string' ||
    typeof decoded.sub !== 'string' ||
    (decoded.role !== 'USER' && decoded.role !== 'ADMIN')
  ) {
    throw new Error('Invalid access token payload');
  }
  return { sub: decoded.sub, role: decoded.role };
}

/** sha256 of a token — what we persist and look up by (never the raw token). */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Mint a new opaque refresh token; return the raw value (for the cookie) and its hash (for the DB). */
export function generateRefreshToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url'); // 256 bits of entropy
  return { token, tokenHash: hashToken(token) };
}

export function refreshTokenExpiry(): Date {
  return new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}
