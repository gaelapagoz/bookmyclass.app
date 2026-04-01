import * as Sentry from "@sentry/nextjs";
import { sanitizeSentryEvent } from "./src/lib/observability/sentry-sanitize";

const environment =
  process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "production";
const release =
  process.env.NEXT_PUBLIC_SENTRY_RELEASE ??
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.05,
  enabled: process.env.NODE_ENV === "production",
  sendDefaultPii: false,
  environment,
  release,
  beforeSend(event) {
    return sanitizeSentryEvent(event);
  },
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
