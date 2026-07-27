/**
 * Central registry of cache keys. Keeping them here (rather than scattered
 * string literals) makes invalidation reliable — you can see exactly which keys
 * a change must clear.
 */
export const cacheKeys = {
  courseList: (cursor: string, limit: number) => `courses:list:${cursor || 'first'}:${limit}`,
  courseListPrefix: 'courses:list:',
  course: (slug: string) => `course:${slug}`,
  lesson: (id: string) => `lesson:${id}`,
};
