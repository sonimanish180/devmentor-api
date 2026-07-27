import type { RequestHandler } from 'express';
import { AppError } from '../lib/AppError';
import { verifyAccessToken, type Role } from '../modules/auth/tokens';

/**
 * Authenticate a request from its `Authorization: Bearer <accessToken>` header.
 * Stateless — the JWT signature is verified, no DB lookup — and the decoded
 * principal is attached as `req.auth`. Rejects missing/invalid/expired tokens
 * with 401.
 */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next(AppError.unauthorized('Missing or malformed Authorization header'));
  }
  try {
    const payload = verifyAccessToken(header.slice('Bearer '.length));
    req.auth = { userId: payload.sub, role: payload.role };
    next();
  } catch {
    next(AppError.unauthorized('Invalid or expired access token'));
  }
};

/**
 * Authorize by role (RBAC). Use after `requireAuth`:
 *   router.delete('/x', requireAuth, requireRole('ADMIN'), handler)
 */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) return next(AppError.unauthorized());
    if (!roles.includes(req.auth.role)) return next(AppError.forbidden('Insufficient role'));
    next();
  };
}
