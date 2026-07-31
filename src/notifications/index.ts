import { env } from '../config/env';
import { logger } from '../lib/logger';
import { inAppNotifier } from './adapters/inAppNotifier';
import { realtimeNotifier } from './adapters/realtimeNotifier';
import { getPreferences, type ChannelPreferences } from './preferences';
import type { Notifier, NotificationMessage } from './notifier';

export type { NotificationMessage, Notifier } from './notifier';
export { getPreferences, updatePreferences, type ChannelPreferences } from './preferences';

interface RegisteredNotifier {
  notifier: Notifier;
  /** Which preference flag gates this channel — checked before every send. */
  preferenceKey: keyof ChannelPreferences;
}

/**
 * Each adapter is paired with the preference flag that gates it (Task 8.4).
 * This is still the ONE place that knows which channels exist and how they're
 * gated — everything else (event subscribers) just calls `notify()` with a
 * message and knows nothing about channels, flags, or user preferences.
 *
 * The realtime adapter is only registered at all behind `REALTIME_ENABLED`
 * (Task 8.3) — turning realtime on/off cluster-wide is a config change here,
 * not a code change anywhere a notification is sent from.
 */
const registry: RegisteredNotifier[] = [
  { notifier: inAppNotifier, preferenceKey: 'inAppEnabled' },
  ...(env.REALTIME_ENABLED ? [{ notifier: realtimeNotifier, preferenceKey: 'realtimeEnabled' as const }] : []),
];

/**
 * Send a notification through every channel the user hasn't disabled. One
 * channel failing (e.g. a transient DB blip) must not stop the others —
 * `allSettled`, not `all`, and each failure is logged rather than thrown,
 * since a notification is best-effort UX, not a guarantee the caller should
 * have to handle.
 */
export async function notify(message: NotificationMessage): Promise<void> {
  const prefs = await getPreferences(message.userId);
  const active = registry.filter((r) => prefs[r.preferenceKey]);

  const results = await Promise.allSettled(active.map((r) => r.notifier.send(message)));
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      logger.error(
        { notifier: active[i]?.notifier.name, err: result.reason, userId: message.userId, type: message.type },
        'notifier failed',
      );
    }
  });
}
