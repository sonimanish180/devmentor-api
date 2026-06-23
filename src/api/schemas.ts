import { z } from 'zod';

/**
 * Shared request DTOs. The zod schema is the single source of truth: it both
 * validates/coerces at runtime AND gives us the static type via z.infer — so the
 * type and the validation can never drift apart.
 */

/** Keyset pagination query (?cursor=...&limit=...). Query values arrive as
 *  strings, so `limit` is coerced to a bounded number. */
export const paginationQuery = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuery>;
