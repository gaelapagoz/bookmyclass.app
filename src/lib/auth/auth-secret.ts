function normalizeEnvValue(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

export function getRequiredAuthSecret(): string {
  const secret = normalizeEnvValue(process.env.AUTH_SECRET);
  if (!secret) {
    throw new Error("Missing required env var: AUTH_SECRET");
  }

  return secret;
}
