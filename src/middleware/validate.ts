import type { RequestHandler } from 'express';
import { z, type ZodTypeAny } from 'zod';

interface Schemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/**
 * Validate (and coerce) the request at the edge against zod schemas.
 *
 * Everything past this middleware can trust its inputs — no defensive checks in
 * handlers. We validate body/query/params in a single parse so a request with
 * several problems reports them all at once, with paths like "body.email".
 * On failure we forward the ZodError to the central error handler, which renders
 * it as a 400 VALIDATION_ERROR envelope. On success we write the parsed
 * (coerced) values back, so e.g. a numeric query string arrives as a number.
 */
export function validate(schemas: Schemas): RequestHandler {
  const schema = z.object({
    body: schemas.body ?? z.any(),
    query: schemas.query ?? z.any(),
    params: schemas.params ?? z.any(),
  });

  return (req, _res, next) => {
    const result = schema.safeParse({ body: req.body, query: req.query, params: req.params });
    if (!result.success) return next(result.error); // -> 400 VALIDATION_ERROR

    // Write coerced values back. req.query/params are getters in Express, so we
    // mutate them in place rather than reassigning.
    if (schemas.body) req.body = result.data.body;
    if (schemas.query) Object.assign(req.query, result.data.query);
    if (schemas.params) Object.assign(req.params, result.data.params);
    next();
  };
}
