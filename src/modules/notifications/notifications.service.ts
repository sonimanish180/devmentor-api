import * as repo from './notifications.repository';
import { getPreferences, updatePreferences, type ChannelPreferences } from '../../notifications';
import type { PageParams } from '../../lib/pagination';

export function listNotifications(userId: string, params: PageParams) {
  return repo.listForUser(userId, params);
}

export function markNotificationRead(userId: string, notificationId: string) {
  return repo.markRead(userId, notificationId);
}

export function getUnreadCount(userId: string) {
  return repo.unreadCount(userId);
}

export function getNotificationPreferences(userId: string) {
  return getPreferences(userId);
}

export function updateNotificationPreferences(userId: string, patch: Partial<ChannelPreferences>) {
  return updatePreferences(userId, patch);
}
