export class AppUrlConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppUrlConfigError";
  }
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    normalized === "0:0:0:0:0:0:0:1" ||
    normalized === "[0:0:0:0:0:0:0:1]" ||
    normalized === "::ffff:127.0.0.1"
  );
}

function isPrivateIpv4Host(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) {
    return false;
  }

  const octets = parts.map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }

  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

function isPrivateIpv6Host(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  return (
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  );
}

function isInternalHostname(host: string): boolean {
  const normalized = host.toLowerCase();
  if (normalized.includes(":")) {
    return false;
  }

  return (
    !normalized.includes(".") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".lan") ||
    normalized.endsWith(".home") ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".localdomain")
  );
}

function parseAbsoluteAppUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new AppUrlConfigError("APP_URL must be an absolute URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AppUrlConfigError("APP_URL must use http or https.");
  }

  return parsed;
}

function normalizeAppUrlOrigin(value: string, options?: { allowPrivateDevHost: boolean }): string {
  const trimmed = value.trim();
  const parsed = parseAbsoluteAppUrl(trimmed);
  const normalizedOrigin = parsed.origin;

  if (!options?.allowPrivateDevHost && isLoopbackHost(parsed.hostname)) {
    throw new AppUrlConfigError("APP_URL must be configured to a non-localhost URL in production.");
  }

  if (!options?.allowPrivateDevHost && isPrivateIpv4Host(parsed.hostname)) {
    throw new AppUrlConfigError("APP_URL must not use a private-network host in production.");
  }

  if (!options?.allowPrivateDevHost && isPrivateIpv6Host(parsed.hostname)) {
    throw new AppUrlConfigError("APP_URL must not use a private-network host in production.");
  }

  if (!options?.allowPrivateDevHost && isInternalHostname(parsed.hostname)) {
    throw new AppUrlConfigError("APP_URL must use a public hostname in production.");
  }

  return normalizedOrigin;
}

export function resolveAppUrl(inputAppUrl?: string): string {
  const resolved = inputAppUrl?.trim() || process.env.APP_URL?.trim();
  if (!resolved) {
    throw new AppUrlConfigError("APP_URL is required when generating absolute URLs.");
  }

  const isProduction = process.env.NODE_ENV === "production";
  const allowPrivateDevHost = !isProduction;
  return normalizeAppUrlOrigin(resolved, { allowPrivateDevHost });
}

export function validateProductionAppUrl(): void {
  const value = process.env.APP_URL?.trim();
  if (!value) {
    throw new AppUrlConfigError("Missing required production environment variable: APP_URL");
  }

  normalizeAppUrlOrigin(value, { allowPrivateDevHost: false });
}
