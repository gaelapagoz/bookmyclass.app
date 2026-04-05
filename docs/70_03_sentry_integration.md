# Sentry Integration

Purpose: document current Sentry integration behavior.

## Runtime Coverage
- Server init: `sentry.server.config.ts`.
- Edge init: `sentry.edge.config.ts`.
- Client init: `instrumentation-client.ts`.
- Server instrumentation bootstrap: `instrumentation.ts`.

## Current Behavior
- Sentry is enabled in production runtime.
- Environment and release metadata are resolved from env variables.
- Event sanitizer runs before send to reduce sensitive data leakage.
- `sendDefaultPii` is disabled.

## Operational Note
- DSN and related Sentry env vars are optional but required for active event delivery.

## Canonical References
- `instrumentation.ts`
- `instrumentation-client.ts`
- `sentry.server.config.ts`
- `sentry.edge.config.ts`
- `src/lib/observability/sentry-sanitize.ts`
