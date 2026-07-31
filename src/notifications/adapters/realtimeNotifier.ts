import { publishRealtime } from '../../realtime/gateway';
import type { Notifier, NotificationMessage } from '../notifier';

/**
 * The realtime adapter — pushes over WebSocket (via Redis pub/sub) to any
 * client currently connected. Deliberately best-effort: if nobody's
 * connected, the message is simply not delivered live (the in-app adapter's
 * `Notification` row is still the durable record the client sees on next
 * load/poll). Only registered when `REALTIME_ENABLED=true` (Task 8.3).
 */
export const realtimeNotifier: Notifier = {
  name: 'realtime',
  async send(message: NotificationMessage): Promise<void> {
    await publishRealtime(message.userId, {
      type: message.type,
      title: message.title,
      body: message.body,
      data: message.data,
    });
  },
};
