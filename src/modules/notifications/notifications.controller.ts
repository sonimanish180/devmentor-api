import type { Request, Response } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import * as notificationsService from './notifications.service';

export const listNotifications = asyncHandler(async (req: Request, res: Response) => {
  const { cursor, limit } = req.query as { cursor?: string; limit?: number };
  res.json(await notificationsService.listNotifications(req.auth!.userId, { cursor, limit }));
});

export const markRead = asyncHandler(async (req: Request, res: Response) => {
  const result = await notificationsService.markNotificationRead(req.auth!.userId, req.params.id as string);
  res.status(200).json(result); // idempotent — same 200 whether this call or an earlier one did the marking
});

export const unreadCount = asyncHandler(async (req: Request, res: Response) => {
  res.json({ count: await notificationsService.getUnreadCount(req.auth!.userId) });
});

export const getPreferences = asyncHandler(async (req: Request, res: Response) => {
  res.json(await notificationsService.getNotificationPreferences(req.auth!.userId));
});

export const updatePreferences = asyncHandler(async (req: Request, res: Response) => {
  res.json(await notificationsService.updateNotificationPreferences(req.auth!.userId, req.body));
});
