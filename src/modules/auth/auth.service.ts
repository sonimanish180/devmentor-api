import { AppError } from '../../lib/AppError';
import { logger } from '../../lib/logger';
import { enqueueWelcomeEmail } from '../../queues/email.queue';
import { hashPassword, verifyPassword } from './password';
import {
  signAccessToken,
  generateRefreshToken,
  hashToken,
  refreshTokenExpiry,
  type Role,
} from './tokens';
import * as repo from './auth.repository';

interface UserRecord {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  passwordHash: string | null;
}

/** Strip sensitive fields before returning a user to the client. */
function toPublicUser(u: UserRecord) {
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}

/** Issue an access token + a fresh (persisted) refresh token for a user. */
async function issueTokens(user: { id: string; role: Role }) {
  const accessToken = signAccessToken({ sub: user.id, role: user.role });
  const { token: refreshToken, tokenHash } = generateRefreshToken();
  await repo.createRefreshToken({ userId: user.id, tokenHash, expiresAt: refreshTokenExpiry() });
  return { accessToken, refreshToken };
}

export async function register(input: { email: string; password: string; name?: string }) {
  if (await repo.findUserByEmail(input.email)) {
    throw AppError.conflict('Email already registered');
  }
  const passwordHash = await hashPassword(input.password);
  const user = await repo.createUser({ email: input.email, name: input.name, passwordHash });

  // Offload the welcome email to the queue — don't block registration on it,
  // and don't fail registration if enqueue hiccups.
  try {
    await enqueueWelcomeEmail({ type: 'welcome', userId: user.id, email: user.email });
  } catch (err) {
    logger.error({ err, userId: user.id }, 'failed to enqueue welcome email');
  }

  return { user: toPublicUser(user), ...(await issueTokens(user)) };
}

export async function login(input: { email: string; password: string }) {
  const user = await repo.findUserByEmail(input.email);
  // Uniform error whether the email is unknown or the password is wrong — don't
  // reveal which emails are registered. verifyPassword is constant-time.
  if (!user || !user.passwordHash || !(await verifyPassword(user.passwordHash, input.password))) {
    throw AppError.unauthorized('Invalid email or password');
  }
  return { user: toPublicUser(user), ...(await issueTokens(user)) };
}

export async function getMe(userId: string) {
  const user = await repo.findUserById(userId);
  if (!user) throw AppError.unauthorized();
  return toPublicUser(user);
}

/**
 * Exchange a refresh token for a new pair (rotation), with reuse detection:
 * presenting an already-rotated (revoked) token means it was likely stolen and
 * replayed — so we revoke ALL of the user's tokens, forcing a full re-login.
 */
export async function refresh(rawToken: string) {
  const stored = await repo.findRefreshTokenByHash(hashToken(rawToken));
  if (!stored) throw AppError.unauthorized('Invalid refresh token');

  if (stored.revokedAt) {
    await repo.revokeAllUserRefreshTokens(stored.userId); // theft response
    throw AppError.unauthorized('Refresh token reuse detected');
  }
  if (stored.expiresAt < new Date()) {
    throw AppError.unauthorized('Refresh token expired');
  }

  await repo.revokeRefreshToken(stored.id); // rotate: retire the used token
  const user = await repo.findUserById(stored.userId);
  if (!user) throw AppError.unauthorized();
  return { user: toPublicUser(user), ...(await issueTokens(user)) };
}

export async function logout(rawToken: string | undefined) {
  if (!rawToken) return;
  const stored = await repo.findRefreshTokenByHash(hashToken(rawToken));
  if (stored && !stored.revokedAt) await repo.revokeRefreshToken(stored.id);
}
