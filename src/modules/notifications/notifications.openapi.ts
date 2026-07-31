import { registerPath } from '../../api/openapi';

export function registerNotificationsOpenApi(): void {
  registerPath('/notifications', {
    get: {
      summary: "The current user's notification history (bell), newest first",
      tags: ['Notifications'],
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'cursor', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'limit', in: 'query', required: false, schema: { type: 'integer', maximum: 100 } },
      ],
      responses: { '200': { description: 'Keyset page of notifications' }, '401': { description: 'Unauthenticated' } },
    },
  });
  registerPath('/notifications/unread-count', {
    get: {
      summary: 'Unread notification count (for a bell badge)',
      tags: ['Notifications'],
      security: [{ bearerAuth: [] }],
      responses: { '200': { description: '{ count }' }, '401': { description: 'Unauthenticated' } },
    },
  });
  registerPath('/notifications/preferences', {
    get: {
      summary: "The current user's notification channel preferences",
      tags: ['Notifications'],
      security: [{ bearerAuth: [] }],
      responses: { '200': { description: '{ inAppEnabled, realtimeEnabled, emailEnabled }' }, '401': { description: 'Unauthenticated' } },
    },
    patch: {
      summary: 'Update one or more channel preferences (partial update)',
      tags: ['Notifications'],
      security: [{ bearerAuth: [] }],
      responses: {
        '200': { description: 'Updated preferences' },
        '400': { description: 'No fields provided', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        '401': { description: 'Unauthenticated' },
      },
    },
  });
  registerPath('/notifications/{id}/read', {
    post: {
      summary: 'Mark a notification as read (idempotent)',
      tags: ['Notifications'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: {
        '200': { description: 'Marked read (or already was)' },
        '404': { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    },
  });
}
