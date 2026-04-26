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
  return resolveEntitlementScopeFromCategorySlug(input.categorySlug);
}
