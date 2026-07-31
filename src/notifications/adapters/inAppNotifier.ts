import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import type { Notifier, NotificationMessage } from '../notifier';

/**
 * The in-app adapter — the one channel that's always durable and always on:
 * every notification is written to the `Notification` table regardless of
 * which other channels also fire, so the bell/history (Task 8.2) is a
 * reliable record even if realtime/email delivery is disabled or fails.
 */
export const inAppNotifier: Notifier = {
  name: 'in-app',
  async send(message: NotificationMessage): Promise<void> {
    await prisma.notification.create({
      data: {
        userId: message.userId,
        type: message.type,
        title: message.title,
        body: message.body,
        data: message.data as Prisma.InputJsonValue | undefined,
      },
    });
  },
};
