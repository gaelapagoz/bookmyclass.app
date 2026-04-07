import { get } from "../lib/http.js";
import { assertJsonPath, assertStatus } from "../lib/checks.js";
import { pace } from "../lib/pacing.js";
import { pickServiceSeed } from "../lib/data.js";

function monthKeyFrom(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function dateKeyFrom(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function resolveBrowseServiceSlug(categoriesResponse, servicesResponse) {
  const envSlug = (__ENV.SERVICE_SLUG || "").trim();
  if (envSlug) {
    return envSlug;
  }

  const seeded = pickServiceSeed();
  if (seeded?.serviceSlug) {
    return String(seeded.serviceSlug);
  }

  const servicesList =
    servicesResponse &&
    servicesResponse.services &&
    Array.isArray(servicesResponse.services) &&
    servicesResponse.services.length > 0
      ? servicesResponse.services
      : [];
  if (servicesList[0]?.slug) {
    return String(servicesList[0].slug);
  }

  const categories =
    categoriesResponse &&
    categoriesResponse.categories &&
    Array.isArray(categoriesResponse.categories) &&
    categoriesResponse.categories.length > 0
      ? categoriesResponse.categories
      : [];
  if (!categories[0]?.slug) {
    throw new Error("Could not resolve a service slug for browse scenario.");
  }

  return String(categories[0].slug);
}

export function browseScenario() {
  const categoriesRes = get("/api/categories", {
    tags: { flow: "browse", endpoint: "categories" },
  });
  assertStatus(categoriesRes, 200, "browse categories status");
  assertJsonPath(categoriesRes, "browse categories list present", (body) => Array.isArray(body.categories));
  pace();

  const categoriesBody = categoriesRes.json();
  const firstCategorySlug =
    categoriesBody && Array.isArray(categoriesBody.categories) && categoriesBody.categories[0]?.slug
      ? String(categoriesBody.categories[0].slug)
      : null;

  const categoryForServices = firstCategorySlug || "yoga";
  const servicesRes = get(`/api/services?category=${encodeURIComponent(categoryForServices)}`, {
    tags: { flow: "browse", endpoint: "services" },
  });
  assertStatus(servicesRes, 200, "browse services status");
  assertJsonPath(servicesRes, "browse services list present", (body) => Array.isArray(body.services));
  pace();

  const serviceSlug = resolveBrowseServiceSlug(categoriesBody, servicesRes.json());
  const serviceRes = get(`/api/services/${encodeURIComponent(serviceSlug)}`, {
    tags: { flow: "browse", endpoint: "service_detail" },
  });
  assertStatus(serviceRes, [200, 404], "browse service detail status");
  if (serviceRes.status === 404) {
    return;
  }
  pace();

  const now = new Date();
  const monthKey = monthKeyFrom(now);
  const availabilityRes = get(
    `/api/services/${encodeURIComponent(serviceSlug)}/availability?month=${encodeURIComponent(monthKey)}`,
    { tags: { flow: "browse", endpoint: "service_availability" } },
  );
  assertStatus(availabilityRes, [200, 404], "browse service availability status");
  pace();

  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const dateKey = dateKeyFrom(tomorrow);
  const slotsRes = get(`/api/services/${encodeURIComponent(serviceSlug)}/slots?date=${encodeURIComponent(dateKey)}`, {
    tags: { flow: "browse", endpoint: "service_slots" },
  });
  assertStatus(slotsRes, [200, 404], "browse service slots status");
  pace();

  const nextRes = get(
    `/api/services/${encodeURIComponent(serviceSlug)}/next-availability?from=${encodeURIComponent(dateKey)}`,
    { tags: { flow: "browse", endpoint: "service_next_availability" } },
  );
  assertStatus(nextRes, [200, 404], "browse next availability status");
}

