import { createHash } from "node:crypto";

function normalizePayload(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(normalizePayload);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, normalizePayload(entryValue)]),
    );
  }

  return value;
}

export function hashGiftCardPayload(payload: unknown): string {
  const serialized = JSON.stringify(normalizePayload(payload));
  return createHash("sha256").update(serialized).digest("hex");
}
