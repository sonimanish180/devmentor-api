import argon2 from 'argon2';

/**
 * Password hashing with argon2id — the current OWASP-recommended algorithm.
 *
 * Why hashing (not encryption): we must NEVER be able to recover the original
 * password. A slow, salted, memory-hard hash means that even if the database
 * leaks, brute-forcing each hash is prohibitively expensive. argon2 salts each
 * hash automatically and embeds the salt + parameters in the output string, so
 * verification needs only the stored hash.
 *
 * Parameters follow an OWASP baseline (argon2id, ~19 MiB, 2 iterations). Tune
 * upward as hardware improves; argon2.verify reads the params from the hash, so
 * raising them here does not break existing hashes.
 */
const HASH_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456, // KiB (~19 MiB)
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, HASH_OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // A malformed/invalid stored hash should fail closed, not throw.
    return false;
  }
}
