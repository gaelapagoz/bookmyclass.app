import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

function buildContentSecurityPolicy() {
  // TODO(security): tighten directives further once we capture runtime-only domain telemetry from UAT.
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    // Next.js + current UI patterns require inline styles in several places.
    "style-src 'self' 'unsafe-inline'",
    // Keep permissive enough for current runtime behavior while we harden in follow-up.
    "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
    "font-src 'self' data:",
    "img-src 'self' data: blob: https://www.google.com",
    "frame-src 'self' https://www.google.com https://www.youtube.com https://challenges.cloudflare.com https://checkout.stripe.com",
    "connect-src 'self' https://challenges.cloudflare.com https://api.stripe.com https://checkout.stripe.com",
    "form-action 'self' https://checkout.stripe.com",
  ];

  return directives.join("; ");
}

function buildBaseSecurityHeaders() {
  const headers = [
    {
      key: "X-Content-Type-Options",
      value: "nosniff",
    },
    {
      key: "Referrer-Policy",
      value: "strict-origin-when-cross-origin",
    },
    {
      key: "X-Frame-Options",
      value: "DENY",
    },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=()",
    },
    {
      key: "Cross-Origin-Resource-Policy",
      value: "same-origin",
    },
    {
      key: "Cross-Origin-Embedder-Policy",
      value: "require-corp",
    },
    {
      key: "Cross-Origin-Opener-Policy",
      value: "same-origin",
    },
  ];

  return headers;
}

function buildDocumentSecurityHeaders() {
  const headers = [
    {
      key: "Content-Security-Policy",
      value: buildContentSecurityPolicy(),
    },
    ...buildBaseSecurityHeaders(),
  ];

  // Add HSTS only in production-like environments (not localhost/dev)
  if (process.env.NODE_ENV === "production" || process.env.APP_URL?.includes("uat.") || process.env.APP_URL?.includes("bookmyclass.app")) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=31536000; includeSubDomains",
    });
  }

  return headers;
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactCompiler: true,
  async headers() {
    return [
      {
        source: "/_next/static/:path*",
        headers: buildBaseSecurityHeaders(),
      },
      {
        source: "/robots.txt",
        headers: buildBaseSecurityHeaders(),
      },
      {
        source: "/:path*",
        headers: buildDocumentSecurityHeaders(),
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  telemetry: false,
  sourcemaps: {
    disable: process.env.NODE_ENV !== "production",
  },
});
