const LEARNING_IMAGE_PATH_PATTERN = /^\/images\/learning\/[A-Za-z0-9][A-Za-z0-9._-]*\.jpg$/;

export function isLearningImagePath(value: string): boolean {
  return LEARNING_IMAGE_PATH_PATTERN.test(value.trim());
}

export function normalizeLearningImagePath(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return isLearningImagePath(trimmed) ? trimmed : null;
}

export function assertLearningImagePath(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  const normalized = normalizeLearningImagePath(value);

  if (typeof value === "string" && value.trim() && !normalized) {
    throw new Error(`${fieldName} must use /images/learning/*.jpg.`);
  }

  return normalized;
}
