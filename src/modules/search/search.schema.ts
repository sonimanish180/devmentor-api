import { z } from 'zod';

export const searchQuery = z.object({
  q: z.string().min(2).max(200),
  page: z.coerce.number().int().positive().max(1000).optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
});
export type SearchQuery = z.infer<typeof searchQuery>;
