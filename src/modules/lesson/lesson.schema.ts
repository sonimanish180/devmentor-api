import { z } from 'zod';

/** Path params for lesson-by-id routes. */
export const lessonIdParams = z.object({
  id: z.string().min(1),
});
export type LessonIdParams = z.infer<typeof lessonIdParams>;
