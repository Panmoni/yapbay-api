// OpenTelemetry SDK bootstrap.
//
// Imported at the very top of server.ts so the SDK can patch http/express/pg
// modules before they're required by the rest of the codebase.
//
// Behavior is gated by OTEL_EXPORTER_OTLP_ENDPOINT:
// - unset -> SDK does nothing (zero overhead for tests, CI, local dev)
// - set -> validated, then OTLP/HTTP exporter + auto-instrumentations
//
// Signals are NOT handled here — `server.ts` owns the shutdown sequence and
// calls `shutdownTracing()` at the right moment. Registering handlers in two
// places used to cause shutdown races.

import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';

function validateEndpoint(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
      console.error('OTEL_EXPORTER_OTLP_ENDPOINT must be https:// in production');
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

let sdk: NodeSDK | null = null;

const endpointRaw = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
if (endpointRaw) {
  const endpoint = validateEndpoint(endpointRaw);
  if (endpoint) {
    sdk = new NodeSDK({
      serviceName: process.env.OTEL_SERVICE_NAME ?? 'yapbay-api',
      traceExporter: new OTLPTraceExporter({
        url: `${endpoint.toString().replace(/\/$/, '')}/v1/traces`,
      }),
      instrumentations: [
        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-fs': { enabled: false },
        }),
      ],
    });
    sdk.start();
  } else {
    console.error(
      `OTEL_EXPORTER_OTLP_ENDPOINT is not a valid URL: ${endpointRaw} — tracing disabled`,
    );
  }
}

/** Stop the OTel SDK. Called by server.ts shutdown sequence. No-op if unset. */
export async function shutdownTracing(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
    sdk = null;
  }
}
