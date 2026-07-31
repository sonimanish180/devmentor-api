import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { PrismaInstrumentation } from '@prisma/instrumentation';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

/**
 * Bootstraps OpenTelemetry tracing. THIS FILE MUST BE THE FIRST THING
 * IMPORTED by every entrypoint (server.ts, worker.ts) — auto-instrumentation
 * works by monkey-patching modules (http, express, ioredis, …) the moment
 * they're `require`d. Since our build is CommonJS, `require` runs top to
 * bottom; if anything imports (and therefore `require`s) express/ioredis
 * before this module has started the SDK, those modules load un-patched and
 * silently produce no spans — a notoriously easy mistake to make, and one
 * that gives no error, just quietly missing traces.
 *
 * Auto-instrumentation covers http/express/ioredis. Prisma is NOT auto-
 * instrumented by the generic package — it needs its own instrumentation
 * class (`@prisma/instrumentation`) AND `previewFeatures = ["tracing"]` on
 * the Prisma generator, so the query engine actually emits spans to hand off.
 */
const serviceName = process.env.OTEL_SERVICE_NAME ?? 'devmentor-api';
const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318/v1/traces';

const sdk = new NodeSDK({
  resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName }),
  traceExporter: new OTLPTraceExporter({ url: otlpEndpoint }),
  instrumentations: [
    getNodeAutoInstrumentations({
      // Health/readiness probes and the metrics scrape endpoint are noise in
      // a trace backend — nobody debugs a request by looking at /health.
      '@opentelemetry/instrumentation-http': {
        ignoreIncomingRequestHook: (req) => req.url === '/health' || req.url === '/ready' || req.url === '/metrics',
      },
    }),
    new PrismaInstrumentation(),
  ],
});

sdk.start();

/** Called from each process's graceful-shutdown path so buffered spans flush before exit. */
export async function shutdownTracing(): Promise<void> {
  await sdk.shutdown();
}
