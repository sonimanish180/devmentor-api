import { registerPath } from '../../api/openapi';

const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});

/** Register the course endpoints into the OpenAPI contract. */
export function registerCourseOpenApi(): void {
  registerPath('/courses', {
    get: {
      summary: 'List published courses (keyset paginated)',
      tags: ['Courses'],
      parameters: [
        { name: 'cursor', in: 'query', required: false, schema: { type: 'string' }, description: 'Opaque cursor from a previous page.' },
        { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
      ],
      responses: {
        '200': { description: 'A page of courses: { items, nextCursor, hasMore }' },
        '400': errorResponse('Validation error'),
      },
    },
  });

  registerPath('/courses/{slug}', {
    get: {
      summary: 'Get a published course with its modules and lessons',
      tags: ['Courses'],
      parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
      responses: {
        '200': { description: 'The course with nested modules and lessons' },
        '404': errorResponse('Course not found'),
      },
    },
  });
}
