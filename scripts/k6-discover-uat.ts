import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const DEFAULT_BASE_URL = "https://uat.bookmyclass.app";
const SERVICES_SEED_PATH = "k6/data/services.json";
const PRODUCTS_SEED_PATH = "k6/data/products.json";
const MIN_SPARE_SPOTS = 3;
const MAX_SESSION_POOL_SIZE = 12;
const MIN_SESSION_POOL_SIZE = 3;
const MONTHS_TO_SCAN = 2;

type PublicCategory = {
  slug: string;
  name: string;
};

type PublicService = {
  slug: string;
  title: string;
  pricingMode: "SINGLE_ONLY" | "PLAN_ONLY" | "SINGLE_OR_PLAN";
};

type NextAvailabilityPayload = {
  next: {
    id: string;
    date: string;
    isAvailable?: boolean;
    availableSpots?: number;
    capacity?: number;
  } | null;
};

type ServiceMonthAvailabilityPayload = {
  month: string | null;
  days: Array<{
    date: string;
    totalSlots: number;
    availableSlots: number;
    hasAvailability: boolean;
  }>;
};

type ServiceSlotsPayload = {
  date: string | null;
  slots: Array<{
    id: string;
    date: string;
    isAvailable: boolean;
    availableSpots?: number;
    capacity?: number;
  }>;
};

type SessionCandidate = {
  sessionId: string;
  date: string;
  availableSpots: number;
  capacity: number;
};

type SubscriptionCatalogItem = {
  productId: string;
  priceId: string;
  productType:
    | "DROP_IN_CLASS"
    | "CLASS_PACK"
    | "UNLIMITED_MEMBERSHIP"
    | "INTRO_OFFER"
    | "PRIVATE_CLASS"
    | "WORKSHOP_PASS"
    | "GIFT_CARD";
  priceType: "ONE_TIME" | "RECURRING";
  checkoutEnabled: boolean;
};

type JsonRecord = Record<string, unknown>;

function isObject(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeBaseUrl(input: string | undefined): string {
  const raw = (input || DEFAULT_BASE_URL).trim();
  if (!raw) {
    throw new Error("BASE_URL is required.");
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`BASE_URL is invalid: '${raw}'.`);
  }

  const normalized = parsed.toString().replace(/\/+$/, "");
  const lower = normalized.toLowerCase();
  const isUatLike =
    lower.includes("uat") ||
    lower.includes("staging") ||
    lower.includes("localhost") ||
    lower.includes("127.0.0.1");

  if (!isUatLike) {
    throw new Error(
      `BASE_URL='${normalized}' does not look like UAT/staging/local. This helper is intentionally blocked.`,
    );
  }

  return normalized;
}

function toDateKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toMonthKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function buildMonthKeys(startDate: Date, count: number): string[] {
  const keys: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + i, 1));
    keys.push(toMonthKey(d));
  }
  return keys;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json" },
  });
  const text = await response.text();

  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const reason = typeof parsed === "string" ? parsed : text || `HTTP ${response.status}`;
    throw new Error(`GET ${url} failed (${response.status}): ${reason}`);
  }

  return parsed as T;
}

function isCollectiveCategorySlug(slug: string): boolean {
  const lower = slug.toLowerCase();
  return !lower.includes("private") && !lower.includes("workshop");
}

function rankService(service: PublicService): number {
  if (service.pricingMode === "SINGLE_OR_PLAN") {
    return 0;
  }
  if (service.pricingMode === "PLAN_ONLY") {
    return 1;
  }
  return 2;
}

async function collectSessionPoolForService(input: {
  baseUrl: string;
  serviceSlug: string;
  fromDate: string;
}): Promise<{
  sessions: SessionCandidate[];
  sawCapacitySignal: boolean;
}> {
  const sessionById = new Map<string, SessionCandidate>();
  let sawCapacitySignal = false;

  const nextPayload = await fetchJson<NextAvailabilityPayload>(
    `${input.baseUrl}/api/services/${encodeURIComponent(input.serviceSlug)}/next-availability?from=${encodeURIComponent(input.fromDate)}`,
  );

  const monthKeys = buildMonthKeys(new Date(), MONTHS_TO_SCAN);
  const dateKeys = new Set<string>();
  for (const monthKey of monthKeys) {
    const monthPayload = await fetchJson<ServiceMonthAvailabilityPayload>(
      `${input.baseUrl}/api/services/${encodeURIComponent(input.serviceSlug)}/availability?month=${encodeURIComponent(monthKey)}`,
    );
    const days = Array.isArray(monthPayload.days) ? monthPayload.days : [];
    for (const day of days) {
      if (day?.hasAvailability && day?.date) {
        dateKeys.add(String(day.date));
      }
    }
  }

  if (nextPayload?.next?.date) {
    dateKeys.add(String(nextPayload.next.date));
  }

  const sortedDateKeys = Array.from(dateKeys).sort((a, b) => a.localeCompare(b));
  for (const dateKey of sortedDateKeys) {
    const slotsPayload = await fetchJson<ServiceSlotsPayload>(
      `${input.baseUrl}/api/services/${encodeURIComponent(input.serviceSlug)}/slots?date=${encodeURIComponent(dateKey)}`,
    );
    const slots = Array.isArray(slotsPayload?.slots) ? slotsPayload.slots : [];

    for (const slot of slots) {
      const hasAvailableSpots = typeof slot.availableSpots === "number";
      const hasCapacity = typeof slot.capacity === "number";
      if (!hasAvailableSpots || !hasCapacity) {
        continue;
      }

      sawCapacitySignal = true;

      if (!slot.isAvailable || slot.availableSpots <= 0) {
        continue;
      }

      if (slot.availableSpots < MIN_SPARE_SPOTS) {
        continue;
      }

      const sessionId = String(slot.id || "").trim();
      if (!sessionId) {
        continue;
      }

      sessionById.set(sessionId, {
        sessionId,
        date: String(slot.date || dateKey),
        availableSpots: Number(slot.availableSpots),
        capacity: Number(slot.capacity),
      });
    }
  }

  const sessions = Array.from(sessionById.values()).sort((left, right) => {
    const spotsDiff = right.availableSpots - left.availableSpots;
    if (spotsDiff !== 0) {
      return spotsDiff;
    }

    const capacityDiff = right.capacity - left.capacity;
    if (capacityDiff !== 0) {
      return capacityDiff;
    }

    const dateDiff = left.date.localeCompare(right.date);
    if (dateDiff !== 0) {
      return dateDiff;
    }

    return left.sessionId.localeCompare(right.sessionId);
  });

  return {
    sessions: sessions.slice(0, MAX_SESSION_POOL_SIZE),
    sawCapacitySignal,
  };
}

async function discoverCollectiveBookingSeed(baseUrl: string): Promise<{
  categorySlug: string;
  serviceSlug: string;
  sessionIds: string[];
  sessionId: string;
  topSessionAvailableSpots: number;
  topSessionCapacity: number;
  sessionPoolSize: number;
}> {
  const categoriesPayload = await fetchJson<{ categories: PublicCategory[] }>(`${baseUrl}/api/categories`);
  const categories = Array.isArray(categoriesPayload.categories) ? categoriesPayload.categories : [];
  if (categories.length === 0) {
    throw new Error("No categories returned from /api/categories.");
  }

  const collectiveCategories = categories
    .filter((category) => isCollectiveCategorySlug(String(category.slug || "")))
    .sort((a, b) => String(a.slug).localeCompare(String(b.slug)));

  if (collectiveCategories.length === 0) {
    throw new Error("No collective category found. All available categories appear private/workshop scoped.");
  }

  const fromDate = toDateKey(new Date());
  let sawCapacitySignalAnywhere = false;

  let bestCandidate: {
    categorySlug: string;
    serviceSlug: string;
    sessions: SessionCandidate[];
  } | null = null;

  for (const category of collectiveCategories) {
    const encodedCategory = encodeURIComponent(String(category.slug));
    const servicesPayload = await fetchJson<{ services: PublicService[] }>(
      `${baseUrl}/api/services?category=${encodedCategory}`,
    );
    const services = Array.isArray(servicesPayload.services) ? servicesPayload.services : [];
    const sortedServices = services
      .slice()
      .sort(
        (left, right) =>
          rankService(left) - rankService(right) || String(left.slug).localeCompare(String(right.slug)),
      );

    for (const service of sortedServices) {
      const poolResult = await collectSessionPoolForService({
        baseUrl,
        serviceSlug: String(service.slug),
        fromDate,
      });

      if (poolResult.sawCapacitySignal) {
        sawCapacitySignalAnywhere = true;
      }

      if (poolResult.sessions.length < MIN_SESSION_POOL_SIZE) {
        continue;
      }

      const candidate = {
        categorySlug: String(category.slug),
        serviceSlug: String(service.slug),
        sessions: poolResult.sessions,
      };

      if (!bestCandidate) {
        bestCandidate = candidate;
        continue;
      }

      const candidateTop = candidate.sessions[0];
      const bestTop = bestCandidate.sessions[0];

      if (candidateTop.availableSpots > bestTop.availableSpots) {
        bestCandidate = candidate;
        continue;
      }

      if (
        candidateTop.availableSpots === bestTop.availableSpots &&
        candidate.sessions.length > bestCandidate.sessions.length
      ) {
        bestCandidate = candidate;
      }
    }
  }

  if (!sawCapacitySignalAnywhere) {
    throw new Error(
      "Booking discovery cannot safely auto-select load-test sessions: slots payload did not expose reliable capacity signals (availableSpots/capacity).",
    );
  }

  if (!bestCandidate) {
    throw new Error(
      `No collective self-service service produced a safe session pool (minimum pool size: ${MIN_SESSION_POOL_SIZE}, minimum available spots per session: ${MIN_SPARE_SPOTS}).`,
    );
  }

  const sessionIds = bestCandidate.sessions.map((session) => session.sessionId);
  const top = bestCandidate.sessions[0];

  return {
    categorySlug: bestCandidate.categorySlug,
    serviceSlug: bestCandidate.serviceSlug,
    sessionIds,
    sessionId: sessionIds[0],
    topSessionAvailableSpots: top.availableSpots,
    topSessionCapacity: top.capacity,
    sessionPoolSize: sessionIds.length,
  };
}

function productPriority(type: SubscriptionCatalogItem["productType"]): number {
  switch (type) {
    case "UNLIMITED_MEMBERSHIP":
      return 0;
    case "CLASS_PACK":
      return 1;
    case "INTRO_OFFER":
      return 2;
    case "DROP_IN_CLASS":
      return 3;
    case "WORKSHOP_PASS":
      return 4;
    case "GIFT_CARD":
      return 5;
    case "PRIVATE_CLASS":
      return 99;
    default:
      return 100;
  }
}

async function discoverProductSeed(baseUrl: string): Promise<{ productId: string; priceId: string }> {
  const payload = await fetchJson<{ products: SubscriptionCatalogItem[] }>(`${baseUrl}/api/subscription/plans`);
  const products = Array.isArray(payload.products) ? payload.products : [];
  if (products.length === 0) {
    throw new Error("No checkout-capable products returned from /api/subscription/plans.");
  }

  const nonPrivate = products.filter((item) => item.productType !== "PRIVATE_CLASS");
  const pool = nonPrivate.length > 0 ? nonPrivate : products;
  const sorted = pool.slice().sort((left, right) => {
    const typeRank = productPriority(left.productType) - productPriority(right.productType);
    if (typeRank !== 0) {
      return typeRank;
    }

    if (left.priceType !== right.priceType) {
      return left.priceType === "RECURRING" ? -1 : 1;
    }

    return left.productId.localeCompare(right.productId);
  });

  const selected = sorted[0];
  if (!selected?.productId || !selected?.priceId) {
    throw new Error("Unable to resolve PRODUCT_ID/PRICE_ID from /api/subscription/plans.");
  }

  return {
    productId: selected.productId,
    priceId: selected.priceId,
  };
}

async function readJsonArray(filePath: string): Promise<unknown[]> {
  const raw = await readFile(filePath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`${filePath} must be a JSON array.`);
  }
  return parsed;
}

function upsertArrayEntry(input: unknown[], targetKeys: string[], updates: JsonRecord): unknown[] {
  const next = input.slice();
  const index = next.findIndex((entry) => isObject(entry) && targetKeys.some((key) => key in entry));

  if (index >= 0) {
    const existing = next[index];
    next[index] = isObject(existing) ? { ...existing, ...updates } : updates;
    return next;
  }

  if (next.length === 0) {
    next.push(updates);
    return next;
  }

  const first = next[0];
  next[0] = isObject(first) ? { ...first, ...updates } : updates;
  return next;
}

async function writePrettyJson(filePath: string, payload: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function main() {
  const baseUrl = normalizeBaseUrl(process.env.BASE_URL);
  const servicesPath = resolve(process.cwd(), SERVICES_SEED_PATH);
  const productsPath = resolve(process.cwd(), PRODUCTS_SEED_PATH);

  const bookingSeed = await discoverCollectiveBookingSeed(baseUrl);
  const productSeed = await discoverProductSeed(baseUrl);

  const servicesData = await readJsonArray(servicesPath);
  const productsData = await readJsonArray(productsPath);

  const nextServicesData = upsertArrayEntry(servicesData, ["serviceSlug", "sessionId", "sessionIds"], {
    serviceSlug: bookingSeed.serviceSlug,
    sessionId: bookingSeed.sessionId,
    sessionIds: bookingSeed.sessionIds,
  });

  const nextProductsData = upsertArrayEntry(productsData, ["productId", "priceId"], {
    productId: productSeed.productId,
    priceId: productSeed.priceId,
  });

  await writePrettyJson(servicesPath, nextServicesData);
  await writePrettyJson(productsPath, nextProductsData);

  console.info(`BASE_URL=${baseUrl}`);
  console.info(`CATEGORY_SLUG=${bookingSeed.categorySlug}`);
  console.info(`SERVICE_SLUG=${bookingSeed.serviceSlug}`);
  console.info(`SESSION_POOL_SIZE=${bookingSeed.sessionPoolSize}`);
  console.info(`SESSION_ID_SAMPLE=${bookingSeed.sessionIds.slice(0, 5).join(",")}`);
  console.info(`SESSION_AVAILABLE_SPOTS_TOP=${bookingSeed.topSessionAvailableSpots}`);
  console.info(`SESSION_CAPACITY_TOP=${bookingSeed.topSessionCapacity}`);
  console.info(`PRODUCT_ID=${productSeed.productId}`);
  console.info(`PRICE_ID=${productSeed.priceId}`);
  console.info(`UPDATED_SERVICES_FILE=${servicesPath}`);
  console.info(`UPDATED_PRODUCTS_FILE=${productsPath}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[k6-discover-uat] failed: ${message}`);
  process.exit(1);
});
