import { registerPath } from '../../api/openapi';

/** Register the lesson endpoints into the OpenAPI contract. */
export function registerLessonOpenApi(): void {
  registerPath('/lessons/{id}', {
    get: {
      summary: 'Get a single lesson with its full content (blocks + quiz)',
      tags: ['Lessons'],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: {
        '200': { description: 'The lesson with its JSONB content blocks and quiz' },
        '404': {
          description: 'Lesson not found',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
    },
  });
}
