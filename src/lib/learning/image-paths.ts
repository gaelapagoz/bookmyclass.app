import { assertCanonicalMediaPublicPath, assertSafeMediaPublicPath } from "@/lib/media";

export function isLearningImagePath(value: string): boolean {
  try {
    const trimmed = value.trim();
    if (trimmed.startsWith("/uploads/")) {
      assertCanonicalMediaPublicPath(trimmed, ["learning"]);
    } else {
      assertSafeMediaPublicPath(trimmed, ["/images/learning"]);
    }
    return /\.(jpe?g|png|webp)$/i.test(value.trim());
  } catch {
    return false;
  }
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
    throw new Error(`${fieldName} must use a JPG, PNG, or WEBP file under /uploads/learning/ (legacy /images/learning/ is accepted for migration only).`);
  }

  return normalized;
}
