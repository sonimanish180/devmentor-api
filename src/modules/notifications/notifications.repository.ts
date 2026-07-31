import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/AppError';
import { buildPage, keysetParams, type Page, type PageParams } from '../../lib/pagination';
import type { Notification } from '@prisma/client';

/**
 * History needs NEWEST first, but our cuid ids are deliberately non-sequential
 * (not safe to sort by for recency) — so we sort by `createdAt` (with `id` as
 * a tiebreaker for rows created in the same instant) while still using `id`
 * as the keyset CURSOR. Prisma's cursor pagination only needs the cursor
 * field to be unique, not to match the sort order: it locates the cursor row
 * and continues from there in whatever `orderBy` says.
 */
export async function listForUser(userId: string, params: PageParams): Promise<Page<Notification>> {
  const { limit, take, cursorId } = keysetParams(params);

  const rows = await prisma.notification.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take,
    ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
  });

  return buildPage(rows, limit, (n) => n.id);
}

export async function markRead(userId: string, notificationId: string): Promise<{ alreadyRead: boolean }> {
  const existing = await prisma.notification.findFirst({ where: { id: notificationId, userId } });
  if (!existing) throw AppError.notFound(`Notification not found: ${notificationId}`);
  if (existing.readAt) return { alreadyRead: true }; // idempotent: marking twice is a no-op

  await prisma.notification.update({ where: { id: notificationId }, data: { readAt: new Date() } });
  return { alreadyRead: false };
}

export function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}
