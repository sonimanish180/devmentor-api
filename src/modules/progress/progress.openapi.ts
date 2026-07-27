import { registerPath } from '../../api/openapi';

export function registerProgressOpenApi(): void {
  registerPath('/progress', {
    get: {
      summary: 'Current user progress (XP, streak, completed lessons)',
      tags: ['Progress'],
      security: [{ bearerAuth: [] }],
      responses: { '200': { description: 'Progress summary' }, '401': { description: 'Unauthenticated' } },
    },
  });
  registerPath('/progress/lessons/{id}/complete', {
    post: {
      summary: 'Mark a lesson complete and award XP (idempotent)',
      description: 'Send an Idempotency-Key header to safely retry. Completing twice never double-awards XP.',
      tags: ['Progress'],
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'Idempotency-Key', in: 'header', required: false, schema: { type: 'string' } },
      ],
      responses: {
        '201': { description: 'Lesson completed, XP awarded' },
        '200': { description: 'Already completed (no-op)' },
        '404': { description: 'Lesson not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    },
  });
}
