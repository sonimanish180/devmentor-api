import * as repo from './search.repository';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export interface SearchParams {
  q: string;
  page?: number;
  limit?: number;
}

/**
 * Deliberately OFFSET-paginated, not keyset (contrast with Task 1.5's
 * keyset-everywhere-else rule). Keyset needs a stable, ordered cursor column;
 * here the sort key is a computed, floating-point `rank` that can tie across
 * rows and isn't a real column to index or compare against. Search result
 * sets are also small and rarely paged deep in practice — the complexity
 * keyset ranking pagination would add (a compound (rank, id) cursor, careful
 * float comparisons) isn't worth it for this access pattern.
 */
export async function search({ q, page = 1, limit = DEFAULT_LIMIT }: SearchParams) {
  const boundedLimit = Math.min(Math.max(limit, 1), MAX_LIMIT);
  const boundedPage = Math.max(page, 1);
  const offset = (boundedPage - 1) * boundedLimit;

  const { items, total } = await repo.searchCatalog(q, boundedLimit, offset);

  return {
    items,
    page: boundedPage,
    limit: boundedLimit,
    total,
    hasMore: offset + items.length < total,
  };
}
