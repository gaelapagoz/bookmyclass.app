type CspOptions = {
  nonce?: string;
};

export type CspMode = "report-only" | "enforce";

type HeaderOptions = {
  appUrl?: string;
  forwardedProto?: string | null;
  isProduction?: boolean;
  requestProtocol?: string;
};

const ONE_YEAR_IN_SECONDS = 31536000;

function normalizeProtocol(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.endsWith(":")) return normalized.slice(0, -1);
  return normalized;
}

function resolveRequestProtocol(options: HeaderOptions): string | null {
  const forwarded = normalizeProtocol(options.forwardedProto);
  if (forwarded) return forwarded;
  return normalizeProtocol(options.requestProtocol);
}

function shouldEnableHsts(options: HeaderOptions): boolean {
  const requestProtocol = resolveRequestProtocol(options);
  if (requestProtocol === "http") {
    return false;
  }

  if (requestProtocol === "https") {
    return true;
  }

  const appUrl = options.appUrl?.toLowerCase() ?? "";
  if (appUrl.includes("uat.") || appUrl.includes("bookmyclass.app")) {
    return true;
  }

  return options.isProduction ?? process.env.NODE_ENV === "production";
}

export function buildContentSecurityPolicy(options: CspOptions = {}): string {
  const scriptSrc = ["'self'"];
  if (options.nonce) {
    scriptSrc.push(`'nonce-${options.nonce}'`);
  }
  scriptSrc.push("https://challenges.cloudflare.com");

  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "style-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    "font-src 'self' data:",
    "img-src 'self' data: blob: https://www.google.com",
    "frame-src 'self' https://www.google.com https://www.youtube.com https://challenges.cloudflare.com https://checkout.stripe.com",
    "connect-src 'self' https://challenges.cloudflare.com",
    "form-action 'self' https://checkout.stripe.com",
  ];

  return directives.join("; ");
}

export function resolveCspMode(rawMode: string | null | undefined): CspMode {
  const normalized = rawMode?.trim().toLowerCase();
  if (normalized === "report-only") return "report-only";
  return "enforce";
}

export function resolveEffectiveCspMode(
  rawMode: string | null | undefined,
  options: { isProduction?: boolean; allowReportOnlyInProduction?: boolean } = {},
): CspMode {
  const configuredMode = resolveCspMode(rawMode);
  if (options.isProduction && !(options.allowReportOnlyInProduction && configuredMode === "report-only")) {
    return "enforce";
  }
  return configuredMode;
}

export function getCspHeaderName(mode: CspMode): "Content-Security-Policy" | "Content-Security-Policy-Report-Only" {
  return mode === "report-only" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy";
}

export function buildBaseSecurityHeaders(options: HeaderOptions = {}): Array<{ key: string; value: string }> {
  const headers: Array<{ key: string; value: string }> = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  ];

  if (shouldEnableHsts(options)) {
    headers.push({
      key: "Strict-Transport-Security",
      value: `max-age=${ONE_YEAR_IN_SECONDS}; includeSubDomains`,
    });
  }

  return headers;
}

export function shouldAttachContentSecurityPolicy(pathname: string): boolean {
  if (!pathname) return false;
  if (pathname.startsWith("/api/")) return false;
  if (pathname.startsWith("/cdn-cgi/")) return false;

  if (pathname === "/" || pathname === "") return true;
  if (pathname === "/robots.txt") return true;
  if (pathname === "/sitemap.xml") return true;
  if (pathname === "/_next/image") return true;

  if (pathname.startsWith("/_next/static/")) return false;
  if (pathname.startsWith("/_next/static/media/")) return false;

  const lastSegment = pathname.split("/").pop() ?? "";
  if (!lastSegment.includes(".")) {
    return true;
  }

  return false;
}
