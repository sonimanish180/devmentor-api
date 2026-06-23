import { Router } from 'express';
import { openapiDocument } from './openapi';
import { courseRouter } from '../modules/course/course.routes';
import { lessonRouter } from '../modules/lesson/lesson.routes';

/**
 * The versioned API surface. Mounted at `/api/v1` by the app factory, so the
 * version lives in the URL path — the simplest, most cache- and proxy-friendly
 * versioning scheme. A future breaking revision mounts a separate `/api/v2`
 * router while v1 keeps working.
 *
 * Conventions for routers mounted here:
 *  - resources are plural nouns (`/courses`, `/courses/:slug`)
 *  - verbs are HTTP methods (GET read, POST create, PATCH update, DELETE remove)
 *  - list endpoints are keyset-paginated and return { items, nextCursor, hasMore }
 *  - errors flow through the central handler as the shared Error envelope
 */
export const apiRouter = Router();

// API metadata / discovery.
apiRouter.get('/', (_req, res) => {
  res.json({
    name: 'devmentor-api',
    version: '1.0.0',
    docs: '/api/v1/docs',
    openapi: '/api/v1/openapi.json',
  });
});

// The machine-readable contract.
apiRouter.get('/openapi.json', (_req, res) => {
  res.json(openapiDocument);
});

// Human-readable docs (Redoc rendered from the spec; loaded from CDN, no dep).
apiRouter.get('/docs', (_req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html>
  <head>
    <title>DevMentor API — Docs</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <redoc spec-url="/api/v1/openapi.json"></redoc>
    <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
  </body>
</html>`);
});

// Feature routers.
apiRouter.use('/courses', courseRouter);
apiRouter.use('/lessons', lessonRouter);
