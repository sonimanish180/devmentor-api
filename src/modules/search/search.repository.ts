import { prisma } from '../../lib/prisma';

export interface SearchHit {
  type: 'course' | 'lesson';
  id: string;
  slug: string;
  title: string;
  description: string | null;
  courseSlug: string;
  rank: number;
}

interface SearchRow extends SearchHit {
  totalCount: bigint;
}

export interface SearchPage {
  items: SearchHit[];
  total: number;
}

/**
 * One `UNION ALL` query across courses and lessons — ranked and paginated by
 * POSTGRES ITSELF via `ORDER BY rank ... LIMIT/OFFSET`, not merged and
 * sliced in application code (which would mean fetching every match from
 * both tables up front). `COUNT(*) OVER()` rides along on every returned
 * row so the total for pagination metadata comes from this one query, not a
 * second round-trip. `plainto_tsquery` turns free-text user input into a
 * safe tsquery — unlike `to_tsquery`, it can't be used to inject `&`/`|`/`!`
 * operators via user input.
 *
 * The lesson branch's rank gets a small, capped popularity boost from
 * `SearchIndexEntry.completionCount` (Task 11.3's read model) — `ln(1+n)`
 * so popularity has diminishing returns, and `LEAST(0.3, ...)` so it can
 * nudge rankings but never fully override text relevance.
 */
export async function searchCatalog(query: string, limit: number, offset: number): Promise<SearchPage> {
  const rows = await prisma.$queryRaw<SearchRow[]>`
    SELECT *, COUNT(*) OVER() AS "totalCount" FROM (
      SELECT
        'course'::text AS type,
        id, slug, title, description, slug AS "courseSlug",
        ts_rank("searchVector", plainto_tsquery('english', ${query})) AS rank
      FROM "Course"
      WHERE published = true
        AND "searchVector" @@ plainto_tsquery('english', ${query})

      UNION ALL

      SELECT
        'lesson'::text AS type,
        l.id, l.slug, l.title, l.description, c.slug AS "courseSlug",
        ts_rank(l."searchVector", plainto_tsquery('english', ${query}))
          + LEAST(0.3, ln(1 + coalesce(si."completionCount", 0)) * 0.05) AS rank
      FROM "Lesson" l
      JOIN "Module" m ON m.id = l."moduleId"
      JOIN "Course" c ON c.id = m."courseId"
      LEFT JOIN "SearchIndexEntry" si ON si."lessonId" = l.id
      WHERE c.published = true
        AND l."searchVector" @@ plainto_tsquery('english', ${query})
    ) hits
    ORDER BY rank DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  return {
    items: rows.map(({ totalCount: _totalCount, ...hit }) => hit),
    total: rows.length > 0 ? Number(rows[0]!.totalCount) : 0,
  };
}
