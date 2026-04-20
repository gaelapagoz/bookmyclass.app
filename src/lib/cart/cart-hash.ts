import { createHash } from "node:crypto";

export const CART_HASH_VERSION = "CART_HASH_V1" as const;

export type CartLineInput = {
  productId: string;
  priceId: string;
  quantity: number;
};

export type NormalizedCartHashLine = {
  productId: string;
  priceId: string;
  quantity: number;
};

export type CartHashCanonicalInput = {
  version: typeof CART_HASH_VERSION;
  normalizedLines: NormalizedCartHashLine[];
  canonicalPayload: string;
};

function assertPositiveIntegerQuantity(quantity: number): number {
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new Error("Cart quantity must be a positive integer.");
  }

  return quantity;
}

function normalizeRawLine(line: CartLineInput): NormalizedCartHashLine {
  const productId = line.productId.trim();
  const priceId = line.priceId.trim();
  const quantity = assertPositiveIntegerQuantity(line.quantity);

  if (!productId || !priceId) {
    throw new Error("Cart lines require non-empty productId and priceId.");
  }

  return {
    productId,
    priceId,
    quantity,
  };
}

function cartLineSort(a: NormalizedCartHashLine, b: NormalizedCartHashLine): number {
  if (a.productId === b.productId) {
    if (a.priceId < b.priceId) {
      return -1;
    }
    if (a.priceId > b.priceId) {
      return 1;
    }
    return 0;
  }

  if (a.productId < b.productId) {
    return -1;
  }
  if (a.productId > b.productId) {
    return 1;
  }
  return 0;
}

function serializeLine(line: NormalizedCartHashLine): string {
  return [
    `productId=${encodeURIComponent(line.productId)}`,
    `priceId=${encodeURIComponent(line.priceId)}`,
    `quantity=${line.quantity.toString(10)}`,
  ].join(",");
}

export function buildCartHashCanonicalInput(lines: CartLineInput[]): CartHashCanonicalInput {
  const deduped = new Map<string, NormalizedCartHashLine>();

  for (const rawLine of lines) {
    const normalized = normalizeRawLine(rawLine);
    const key = `${normalized.productId}\u0000${normalized.priceId}`;
    const existing = deduped.get(key);

    if (existing) {
      deduped.set(key, {
        ...existing,
        quantity: existing.quantity + normalized.quantity,
      });
      continue;
    }

    deduped.set(key, normalized);
  }

  const normalizedLines = [...deduped.values()].sort(cartLineSort);
  const serializedLines = normalizedLines.map(serializeLine).join(";");
  const canonicalPayload = `version=${CART_HASH_VERSION}|lineCount=${normalizedLines.length}|lines=${serializedLines}`;

  return {
    version: CART_HASH_VERSION,
    normalizedLines,
    canonicalPayload,
  };
}

export function computeCartHash(lines: CartLineInput[]): string {
  const input = buildCartHashCanonicalInput(lines);
  return createHash("sha256").update(input.canonicalPayload, "utf8").digest("hex");
}
