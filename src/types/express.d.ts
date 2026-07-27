import type { Role } from '../modules/auth/tokens';

/**
 * Attach the authenticated principal to the request. `requireAuth` populates
 * `req.auth`; downstream handlers/guards read it.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: { userId: string; role: Role };
    }
  }
}

export {};
