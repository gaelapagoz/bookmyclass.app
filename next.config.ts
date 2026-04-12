import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import { buildBaseSecurityHeaders } from "./src/lib/security/response-security";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactCompiler: true,
  async headers() {
    const staticAndMetaHeaders = buildBaseSecurityHeaders({
      appUrl: process.env.APP_URL,
      isProduction: false,
    });

    return [
      {
        source: "/_next/static/:path*",
        headers: staticAndMetaHeaders,
      },
      {
        source: "/_next/image",
        headers: staticAndMetaHeaders,
      },
      {
        source: "/robots.txt",
        headers: staticAndMetaHeaders,
      },
      {
        source: "/sitemap.xml",
        headers: staticAndMetaHeaders,
      },
      {
        source: "/:path*",
        headers: staticAndMetaHeaders,
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
