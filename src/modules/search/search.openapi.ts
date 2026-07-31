import { registerPath } from '../../api/openapi';

export function registerSearchOpenApi(): void {
  registerPath('/search', {
    get: {
      summary: 'Full-text search across published courses and lessons',
      description: 'Ranked by Postgres full-text relevance (ts_rank), with a small popularity boost for lessons from completion counts.',
      tags: ['Search'],
      parameters: [
        { name: 'q', in: 'query', required: true, schema: { type: 'string', minLength: 2 } },
        { name: 'page', in: 'query', required: false, schema: { type: 'integer', minimum: 1 } },
        { name: 'limit', in: 'query', required: false, schema: { type: 'integer', maximum: 50 } },
      ],
      responses: {
        '200': { description: 'Ranked, offset-paginated search results' },
        '400': { description: 'Missing or too-short query', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    },
  });
}
