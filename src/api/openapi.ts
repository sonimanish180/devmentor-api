type PathItem = Record<string, unknown>;

/**
 * The OpenAPI document is the API's machine-readable contract: it documents
 * every endpoint, powers the /docs UI, and can generate typed clients. We keep
 * a base document here (info, servers, the shared Error schema) and let each
 * feature register its paths via `registerPath` as endpoints are added.
 */
export const openapiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'DevMentor API',
    version: '1.0.0',
    description:
      'Backend API for DevMentor. All errors share a single envelope — see components.schemas.Error.',
  },
  servers: [{ url: '/api/v1' }],
  paths: {} as Record<string, PathItem>,
  components: {
    schemas: {
      Error: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: { type: 'string', example: 'NOT_FOUND' },
              message: { type: 'string', example: 'Resource not found' },
              details: { description: 'Optional structured detail (e.g. validation issues).' },
              requestId: { type: 'string', description: 'Correlation id, also returned as the x-request-id header.' },
            },
          },
        },
      },
    },
  },
};

/** Merge a path definition into the document (called by feature routers). */
export function registerPath(path: string, item: PathItem): void {
  openapiDocument.paths[path] = { ...(openapiDocument.paths[path] ?? {}), ...item };
}
