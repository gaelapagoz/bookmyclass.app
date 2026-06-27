const DEFAULT_MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;
const BYTES_PER_MEBIBYTE = 1024 * 1024;

export function getMaxProductImageBytes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.PRODUCT_IMAGE_MAX_BYTES ?? env.IMAGE_UPLOAD_MAX_BYTES;
  if (!raw) return DEFAULT_MAX_PRODUCT_IMAGE_BYTES;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_MAX_PRODUCT_IMAGE_BYTES;
  return parsed;
}

export function getProductImageUploadLimitLabel(env: NodeJS.ProcessEnv = process.env): string {
  const maxBytes = getMaxProductImageBytes(env);
  const maxMiB = maxBytes / BYTES_PER_MEBIBYTE;

  if (Number.isInteger(maxMiB)) {
    return `${maxMiB} MB`;
  }

  return `${maxMiB.toFixed(1)} MB`;
}

export function getRecommendedProductImageServerActionBodySizeLimit(
  env: NodeJS.ProcessEnv = process.env,
): `${number}mb` {
  const imageLimitMiB = Math.ceil(getMaxProductImageBytes(env) / BYTES_PER_MEBIBYTE);
  const recommendedMiB = Math.max(8, imageLimitMiB + 2);
  return `${recommendedMiB}mb`;
}
