/**
 * Keyset (cursor) pagination.
 *
 * Offset pagination (`OFFSET n`) gets slower as you page deeper — the DB must
 * count and skip n rows every time — and can skip/repeat rows when data changes
 * mid-paging. Keyset pagination instead remembers the last row's ordered key
 * (the "cursor") and asks for rows *after* it, which stays O(limit) at any depth
 * and is stable under inserts.
 *
 * The cursor is opaque (base64url) so callers treat it as a token, not an id.
 */
export interface PageParams {
  cursor?: string;
  limit?: number;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export function normalizeLimit(limit?: number): number {
  if (!limit || limit < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT); // never let a client request an unbounded page
}

export function encodeCursor(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

export function decodeCursor(cursor?: string): string | undefined {
  if (!cursor) return undefined;
  try {
    return Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    return undefined; // malformed cursor → treat as no cursor
  }
}

/**
 * Derive the query inputs for a keyset page. We fetch `limit + 1` rows so we can
 * tell whether another page exists without a second COUNT query.
 */
export function keysetParams(params: PageParams): { limit: number; take: number; cursorId?: string } {
  const limit = normalizeLimit(params.limit);
  return { limit, take: limit + 1, cursorId: decodeCursor(params.cursor) };
}

/** Turn the (limit + 1) rows returned by the query into a Page. */
export function buildPage<T>(rows: T[], limit: number, getCursor: (row: T) => string): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(getCursor(last)) : null,
    hasMore,
  };
}
