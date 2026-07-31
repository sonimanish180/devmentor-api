import { z } from 'zod';

export const notificationIdParams = z.object({
  id: z.string().min(1),
});
export type NotificationIdParams = z.infer<typeof notificationIdParams>;

export const updatePreferencesBody = z
  .object({
    inAppEnabled: z.boolean().optional(),
    realtimeEnabled: z.boolean().optional(),
    emailEnabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one preference to update' });
export type UpdatePreferencesBody = z.infer<typeof updatePreferencesBody>;
