import { EntitlementScope } from "@prisma/client";

export function resolveEntitlementScopeFromCategorySlug(categorySlug: string): EntitlementScope {
  const slug = categorySlug.toLowerCase();
  if (slug.includes("private")) {
    return EntitlementScope.PRIVATE_CLASSES;
  }
  if (slug.includes("workshop")) {
    return EntitlementScope.WORKSHOPS;
  }
  return EntitlementScope.COLLECTIVE_CLASSES;
}

export function resolveEntitlementScope(input: {
  serviceScope?: EntitlementScope | null;
  categorySlug: string;
}): EntitlementScope {
  if (input.serviceScope) {
    return input.serviceScope;
  }
  console.warn(
    `[entitlement-scope] ClassType.serviceScope is null for category slug "${input.categorySlug}". Falling back to slug heuristic — backfill required.`,
  );
  return resolveEntitlementScopeFromCategorySlug(input.categorySlug);
}
