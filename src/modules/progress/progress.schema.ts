import { z } from 'zod';

export const completeParams = z.object({
  id: z.string().min(1), // lesson id
});
export type CompleteParams = z.infer<typeof completeParams>;
