export const SEEDED_USER_PASSWORD = "Book4Ever!";
export const SEEDED_EMAIL_DOMAIN = "bookmyclass.app";

export const SEEDED_CANONICAL_EMAILS = {
  masterAdmin: `master@${SEEDED_EMAIL_DOMAIN}`,
  admin: `admin@${SEEDED_EMAIL_DOMAIN}`,
  teacher: `teacher@${SEEDED_EMAIL_DOMAIN}`,
  client: `client@${SEEDED_EMAIL_DOMAIN}`,
  e2eClient: `e2e-client@${SEEDED_EMAIL_DOMAIN}`,
  e2eAdmin: `e2e-admin@${SEEDED_EMAIL_DOMAIN}`,
} as const;

export function buildPerfClientEmail(index: number): string {
  return `perf-client-${String(index).padStart(3, "0")}@${SEEDED_EMAIL_DOMAIN}`;
}

export function buildK6ClientEmail(index: number): string {
  return `k6-client-${String(index).padStart(3, "0")}@${SEEDED_EMAIL_DOMAIN}`;
}

export function assertSeedEmailDomain(email: string, envVarName: string): string {
  const normalized = email.trim().toLowerCase();
  if (!normalized.endsWith(`@${SEEDED_EMAIL_DOMAIN}`)) {
    throw new Error(
      `${envVarName} must use @${SEEDED_EMAIL_DOMAIN} seeded domain. Received: ${normalized}`,
    );
  }
  return normalized;
}
