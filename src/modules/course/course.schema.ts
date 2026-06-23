import { z } from 'zod';

/** Path params for course-by-slug routes. */
export const courseSlugParams = z.object({
  slug: z.string().min(1),
});
export type CourseSlugParams = z.infer<typeof courseSlugParams>;
