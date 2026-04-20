"use client";

import { BillingInterval, PriceType, ProductType } from "@prisma/client";
import { createCartValidationRejection } from "@/lib/cart/cart-policy";

export const CART_STORAGE_KEY = "studio_cart_v1";
export const CART_UPDATED_EVENT = "cart:updated";
export const CART_CLEARED_SESSION_PREFIX = "studio_cart_cleared_session_v1:";
export const CART_CHECKOUT_SNAPSHOT_PREFIX = "studio_cart_checkout_snapshot_v1:";
let cartIdempotencyFallbackCounter = 0;

export type ClientCartLine = {
  productId: string;
  priceId: string;
  productName: string;
  productDescription: string | null;
  productType: ProductType;
  priceName: string;
  priceType: PriceType;
  quantity: number;
  unitAmountMinor: number;
  currencyCode: string;
  billingInterval: BillingInterval | null;
  billingIntervalCount: number | null;
};

export type ClientCartState = {
  version: number;
  lines: ClientCartLine[];
};

export type ClientCartValidationResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

export type PurchasedCartLineScope = {
  productId: string;
  priceId: string;
  quantity: number;
};

const EMPTY_CART_STATE: ClientCartState = {
  version: 1,
  lines: [],
};

function normalizeVersion(version: unknown): number {
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return 1;
  }
  return version;
}

function normalizeLine(line: Partial<ClientCartLine> | null | undefined): ClientCartLine | null {
  if (!line) {
    return null;
  }

  if (
    typeof line.productId !== "string" ||
    typeof line.priceId !== "string" ||
    typeof line.productName !== "string" ||
    typeof line.priceName !== "string" ||
    typeof line.unitAmountMinor !== "number" ||
    typeof line.currencyCode !== "string" ||
    typeof line.quantity !== "number" ||
    !Number.isSafeInteger(line.quantity) ||
    line.quantity < 1
  ) {
    return null;
  }

  if (line.priceType !== PriceType.ONE_TIME && line.priceType !== PriceType.RECURRING) {
    return null;
  }

  if (
    line.productType !== ProductType.CLASS_PACK &&
    line.productType !== ProductType.DROP_IN_CLASS &&
    line.productType !== ProductType.UNLIMITED_MEMBERSHIP &&
    line.productType !== ProductType.INTRO_OFFER &&
    line.productType !== ProductType.PRIVATE_CLASS &&
    line.productType !== ProductType.WORKSHOP_PASS &&
    line.productType !== ProductType.GIFT_CARD
  ) {
    return null;
  }

  return {
    productId: line.productId.trim(),
    priceId: line.priceId.trim(),
    productName: line.productName,
    productDescription: line.productDescription ?? null,
    productType: line.productType,
    priceName: line.priceName,
    priceType: line.priceType,
    quantity: line.quantity,
    unitAmountMinor: line.unitAmountMinor,
    currencyCode: line.currencyCode,
    billingInterval: line.billingInterval ?? null,
    billingIntervalCount: line.billingIntervalCount ?? null,
  };
}

function readRawCartState(): ClientCartState {
  if (typeof window === "undefined") {
    return EMPTY_CART_STATE;
  }

  const raw = window.localStorage.getItem(CART_STORAGE_KEY);
  if (!raw) {
    return EMPTY_CART_STATE;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ClientCartState>;
    const lines = Array.isArray(parsed.lines)
      ? parsed.lines
          .map((line) => normalizeLine(line))
          .filter((line): line is ClientCartLine => line !== null)
      : [];

    return {
      version: normalizeVersion(parsed.version),
      lines,
    };
  } catch {
    return EMPTY_CART_STATE;
  }
}

function emitCartUpdated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CART_UPDATED_EVENT));
  }
}

export function readClientCart(): ClientCartState {
  return readRawCartState();
}

export function writeClientCart(lines: ClientCartLine[]): ClientCartState {
  const current = readRawCartState();
  const next: ClientCartState = {
    version: current.version + 1,
    lines,
  };

  if (typeof window !== "undefined") {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(next));
  }
  emitCartUpdated();
  return next;
}

export function clearClientCart() {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(CART_STORAGE_KEY);
  }
  emitCartUpdated();
}

function getCartSnapshotStorageKey(checkoutSessionId: string): string {
  return `${CART_CHECKOUT_SNAPSHOT_PREFIX}${checkoutSessionId}`;
}

export function rememberClientCartSnapshotForCheckoutSession(input: {
  checkoutSessionId: string;
  fingerprint: string;
}): void {
  if (typeof window === "undefined") {
    return;
  }

  const checkoutSessionId = input.checkoutSessionId.trim();
  const fingerprint = input.fingerprint.trim();
  if (!checkoutSessionId || !fingerprint) {
    return;
  }

  window.localStorage.setItem(getCartSnapshotStorageKey(checkoutSessionId), fingerprint);
}

export function maybeClearClientCartAfterConfirmedCheckout(input: {
  checkoutSessionId: string | null;
  cartClearEligible: boolean;
  purchasedLines: PurchasedCartLineScope[];
}): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const checkoutSessionId = input.checkoutSessionId?.trim() ?? "";
  if (!input.cartClearEligible || checkoutSessionId.length === 0) {
    return false;
  }

  const markerKey = `${CART_CLEARED_SESSION_PREFIX}${checkoutSessionId}`;
  if (window.localStorage.getItem(markerKey) === "1") {
    return false;
  }

  const current = readRawCartState();
  const expectedFingerprint = window.localStorage.getItem(
    getCartSnapshotStorageKey(checkoutSessionId),
  );
  if (!expectedFingerprint || getCheckoutSubmissionFingerprint(current.lines) !== expectedFingerprint) {
    window.localStorage.setItem(markerKey, "1");
    return false;
  }
  const pendingByLineKey = new Map<string, number>();
  for (const line of input.purchasedLines) {
    if (
      typeof line.productId !== "string" ||
      typeof line.priceId !== "string" ||
      !Number.isSafeInteger(line.quantity) ||
      line.quantity <= 0
    ) {
      continue;
    }
    const lineKey = `${line.productId}:${line.priceId}`;
    pendingByLineKey.set(lineKey, (pendingByLineKey.get(lineKey) ?? 0) + line.quantity);
  }

  let changed = false;
  const nextLines: ClientCartLine[] = [];
  for (const line of current.lines) {
    const lineKey = `${line.productId}:${line.priceId}`;
    const pending = pendingByLineKey.get(lineKey) ?? 0;
    if (pending <= 0) {
      nextLines.push(line);
      continue;
    }

    changed = true;
    if (pending >= line.quantity) {
      pendingByLineKey.set(lineKey, pending - line.quantity);
      continue;
    }

    pendingByLineKey.set(lineKey, 0);
    nextLines.push({
      ...line,
      quantity: line.quantity - pending,
    });
  }

  if (changed) {
    if (nextLines.length === 0) {
      clearClientCart();
    } else {
      writeClientCart(nextLines);
    }
  }

  window.localStorage.setItem(markerKey, "1");
  return changed;
}

export function subscribeToClientCart(onChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (!event.key || event.key === CART_STORAGE_KEY) {
      onChange();
    }
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(CART_UPDATED_EVENT, onChange);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(CART_UPDATED_EVENT, onChange);
  };
}

function findLineIndex(lines: ClientCartLine[], input: { productId: string; priceId: string }) {
  return lines.findIndex((line) => line.productId === input.productId && line.priceId === input.priceId);
}

function isMixedMode(input: {
  existingLines: ClientCartLine[];
  candidatePriceType: PriceType;
}): boolean {
  if (input.existingLines.length === 0) {
    return false;
  }

  const hasRecurring = input.existingLines.some((line) => line.priceType === PriceType.RECURRING);
  const hasOneTime = input.existingLines.some((line) => line.priceType === PriceType.ONE_TIME);

  if (input.candidatePriceType === PriceType.RECURRING && hasOneTime) {
    return true;
  }

  if (input.candidatePriceType === PriceType.ONE_TIME && hasRecurring) {
    return true;
  }

  return false;
}

export function validateClientCart(input: {
  lines: ClientCartLine[];
  hasActiveSubscription?: boolean;
}): ClientCartValidationResult {
  if (input.lines.length === 0) {
    return {
      ok: false,
      code: "EMPTY_CART",
      message: createCartValidationRejection("EMPTY_CART").message,
    };
  }

  const hasRecurring = input.lines.some((line) => line.priceType === PriceType.RECURRING);
  const hasOneTime = input.lines.some((line) => line.priceType === PriceType.ONE_TIME);
  if (hasRecurring && hasOneTime) {
    return {
      ok: false,
      code: "MIXED_PRICE_TYPES_NOT_ALLOWED",
      message: createCartValidationRejection("MIXED_PRICE_TYPES_NOT_ALLOWED").message,
    };
  }

  const recurringInvalid = input.lines.some(
    (line) => line.priceType === PriceType.RECURRING && line.quantity !== 1,
  );
  if (recurringInvalid) {
    return {
      ok: false,
      code: "RECURRING_QUANTITY_MUST_BE_ONE",
      message: createCartValidationRejection("RECURRING_QUANTITY_MUST_BE_ONE").message,
    };
  }

  if (hasRecurring && input.hasActiveSubscription) {
    return {
      ok: false,
      code: "ACTIVE_SUBSCRIPTION_ALREADY_EXISTS",
      message: createCartValidationRejection("ACTIVE_SUBSCRIPTION_ALREADY_EXISTS").message,
    };
  }

  return { ok: true };
}

export function addLineToClientCart(input: {
  line: ClientCartLine;
  hasActiveSubscription?: boolean;
}):
  | { ok: true; state: ClientCartState }
  | { ok: false; state: ClientCartState; code: string; message: string } {
  const current = readRawCartState();
  const normalized = normalizeLine(input.line);
  if (!normalized) {
    return {
      ok: false,
      state: current,
      code: "INVALID_LINE",
      message: "Invalid cart item.",
    };
  }

  if (normalized.priceType === PriceType.RECURRING && input.hasActiveSubscription) {
    const rejection = createCartValidationRejection("ACTIVE_SUBSCRIPTION_ALREADY_EXISTS");
    return {
      ok: false,
      state: current,
      code: rejection.code,
      message: rejection.message,
    };
  }

  if (isMixedMode({ existingLines: current.lines, candidatePriceType: normalized.priceType })) {
    const rejection = createCartValidationRejection("MIXED_PRICE_TYPES_NOT_ALLOWED");
    return {
      ok: false,
      state: current,
      code: rejection.code,
      message: rejection.message,
    };
  }

  const nextLines = [...current.lines];
  const existingIndex = findLineIndex(nextLines, normalized);
  if (existingIndex === -1) {
    const next = writeClientCart([...nextLines, normalized]);
    return { ok: true, state: next };
  }

  const existing = nextLines[existingIndex];
  if (!existing) {
    const next = writeClientCart([...nextLines, normalized]);
    return { ok: true, state: next };
  }

  if (existing.priceType === PriceType.RECURRING) {
    const rejection = createCartValidationRejection("RECURRING_QUANTITY_MUST_BE_ONE");
    return {
      ok: false,
      state: current,
      code: rejection.code,
      message: rejection.message,
    };
  }

  nextLines[existingIndex] = {
    ...existing,
    quantity: existing.quantity + normalized.quantity,
  };

  const next = writeClientCart(nextLines);
  return { ok: true, state: next };
}

export function updateClientCartLineQuantity(input: {
  productId: string;
  priceId: string;
  quantity: number;
}):
  | { ok: true; state: ClientCartState }
  | { ok: false; state: ClientCartState; code: string; message: string } {
  const current = readRawCartState();
  const index = findLineIndex(current.lines, input);
  if (index < 0) {
    return { ok: true, state: current };
  }

  const line = current.lines[index];
  if (!line) {
    return { ok: true, state: current };
  }

  if (line.priceType === PriceType.RECURRING && input.quantity !== 1) {
    const rejection = createCartValidationRejection("RECURRING_QUANTITY_MUST_BE_ONE");
    return {
      ok: false,
      state: current,
      code: rejection.code,
      message: rejection.message,
    };
  }

  if (input.quantity <= 0) {
    const next = writeClientCart(current.lines.filter((_, lineIndex) => lineIndex !== index));
    return { ok: true, state: next };
  }

  const nextLines = [...current.lines];
  nextLines[index] = {
    ...line,
    quantity: input.quantity,
  };
  const next = writeClientCart(nextLines);
  return { ok: true, state: next };
}

export function removeClientCartLine(input: { productId: string; priceId: string }): ClientCartState {
  const current = readRawCartState();
  const next = writeClientCart(
    current.lines.filter((line) => !(line.productId === input.productId && line.priceId === input.priceId)),
  );
  return next;
}

export function getClientCartItemCount(): number {
  return readRawCartState().lines.reduce((sum, line) => sum + line.quantity, 0);
}

export function getClientCartSubtotalMinor(lines: ClientCartLine[]): number {
  return lines.reduce((sum, line) => sum + line.unitAmountMinor * line.quantity, 0);
}

export function getCheckoutSubmissionFingerprint(lines: ClientCartLine[]): string {
  return lines
    .map((line) => `${line.productId}:${line.priceId}:${line.quantity}`)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .join("|");
}

export function generateCartCheckoutIdempotencyKey(): string {
  const uuid = (() => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }

    const nextCounter = (cartIdempotencyFallbackCounter = (cartIdempotencyFallbackCounter + 1) & 0xffff);
    const seed = Date.now() ^ (Math.random() * 0xffffffff) ^ nextCounter;
    const nibble = () => Math.floor(Math.random() * 16).toString(16);
    const hex = (size: number) =>
      Array.from({ length: size }, (_, index) => {
        if (index === 0) {
          return ((seed >>> 0) & 0xf).toString(16);
        }
        return nibble();
      }).join("");
    const variant = (8 + Math.floor(Math.random() * 4)).toString(16);
    return `${hex(8)}-${hex(4)}-4${hex(3)}-${variant}${hex(3)}-${hex(12)}`;
  })();

  return `cartchk_${uuid}`;
}
