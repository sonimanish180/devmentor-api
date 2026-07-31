import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth';
import { validate } from '../../middleware/validate';
import { paginationQuery } from '../../api/schemas';
import { notificationIdParams, updatePreferencesBody } from './notifications.schema';
import * as notificationsController from './notifications.controller';
import { registerNotificationsOpenApi } from './notifications.openapi';

export const notificationsRouter = Router();

notificationsRouter.get('/', requireAuth, validate({ query: paginationQuery }), notificationsController.listNotifications);
notificationsRouter.get('/unread-count', requireAuth, notificationsController.unreadCount);
notificationsRouter.get('/preferences', requireAuth, notificationsController.getPreferences);
notificationsRouter.patch(
  '/preferences',
  requireAuth,
  validate({ body: updatePreferencesBody }),
  notificationsController.updatePreferences,
);
notificationsRouter.post(
  '/:id/read',
  requireAuth,
  validate({ params: notificationIdParams }),
  notificationsController.markRead,
);

registerNotificationsOpenApi();
