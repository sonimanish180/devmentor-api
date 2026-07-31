import { context, propagation, trace } from '@opentelemetry/api';

/**
 * HTTP requests get trace context propagation for free: auto-instrumentation
 * reads an incoming `traceparent` header and continues that trace, and
 * outbound `http`/`fetch` calls get one injected automatically. Nothing does
 * that across an ASYNC boundary like the transactional outbox — a relay
 * reads a Postgres row and hands its payload to a completely different
 * process (the worker), with no HTTP request/response anywhere in between.
 * Without deliberately propagating it ourselves, "the API request that
 * caused this" and "the worker job that reacted to it" show up as two
 * unrelated traces instead of one connected one.
 */

/** Capture the CURRENT trace context as a plain object, to store alongside an outbox event. */
export function captureTraceCarrier(): Record<string, string> {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier;
}

/**
 * Run `fn` inside a span that continues whatever trace `carrier` came from
 * (falls back to a fresh, unlinked span if there's no carrier — e.g. an
 * older event written before this column existed). This is what makes a
 * worker's processing of an event show up linked to the original request in
 * Jaeger, instead of as an orphaned span with no visible cause.
 */
export async function runWithLinkedTrace<T>(
  tracerName: string,
  spanName: string,
  carrier: Record<string, string> | null | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const parentContext = carrier ? propagation.extract(context.active(), carrier) : context.active();
  const tracer = trace.getTracer(tracerName);
  return context.with(parentContext, () =>
    tracer.startActiveSpan(spanName, async (span) => {
      try {
        return await fn();
      } finally {
        span.end();
      }
    }),
  );
}
