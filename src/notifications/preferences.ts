import { prisma } from '../lib/prisma';

export interface ChannelPreferences {
  inAppEnabled: boolean;
  realtimeEnabled: boolean;
  emailEnabled: boolean;
}

const DEFAULT_PREFERENCES: ChannelPreferences = {
  inAppEnabled: true,
  realtimeEnabled: true,
  emailEnabled: true,
};

/**
 * A missing `NotificationPreference` row means "use the defaults" — so
 * shipping this model required no backfill migration for users that already
 * existed. Only a user who has actually changed a preference ever gets a row.
 */
export async function getPreferences(userId: string): Promise<ChannelPreferences> {
  const row = await prisma.notificationPreference.findUnique({ where: { userId } });
  if (!row) return DEFAULT_PREFERENCES;
  return {
    inAppEnabled: row.inAppEnabled,
    realtimeEnabled: row.realtimeEnabled,
    emailEnabled: row.emailEnabled,
  };
}

/** Partial update — only the provided channels change; an upsert covers users with no row yet. */
export async function updatePreferences(
  userId: string,
  patch: Partial<ChannelPreferences>,
): Promise<ChannelPreferences> {
  const current = await getPreferences(userId);
  const next = { ...current, ...patch };

  const row = await prisma.notificationPreference.upsert({
    where: { userId },
    create: { userId, ...next },
    update: { ...patch },
  });

  return {
    inAppEnabled: row.inAppEnabled,
    realtimeEnabled: row.realtimeEnabled,
    emailEnabled: row.emailEnabled,
  };
}
