import { describe, expect, it } from "vitest";

import { adminNavConfig, type AdminNavGroupItem } from "../../src/lib/navigation/admin-nav";

function getGroup(key: string): AdminNavGroupItem | undefined {
  return adminNavConfig.find(
    (item): item is AdminNavGroupItem => item.type === "group" && item.key === key,
  );
}

describe("adminNavConfig - Store navigation structure", () => {
  it("Catalog group contains one Store entry", () => {
    const catalog = getGroup("catalog");
    expect(catalog).toBeDefined();

    const storeEntries = catalog!.children.filter((child) => child.label.startsWith("Store"));

    expect(storeEntries).toHaveLength(1);
    expect(storeEntries[0]).toMatchObject({
      href: "/admin/store",
      label: "Store",
      matchPrefixes: ["/admin/store/merchandise", "/admin/store/gift-cards"],
    });
  });

  it("Catalog group does not contain split Store entries", () => {
    const catalog = getGroup("catalog");
    expect(catalog).toBeDefined();
    const hrefs = catalog!.children.map((child) => child.href);

    expect(hrefs).not.toContain("/admin/store/merchandise");
    expect(hrefs).not.toContain("/admin/store/gift-cards");
  });

  it("Catalog group does not contain the old /admin/gift-cards wallet entry", () => {
    const catalog = getGroup("catalog");
    expect(catalog).toBeDefined();
    const hrefs = catalog!.children.map((child) => child.href);
    expect(hrefs).not.toContain("/admin/gift-cards");
  });

  it("Sales group contains Gift Cards entry pointing to /admin/gift-cards", () => {
    const sales = getGroup("sales");
    expect(sales).toBeDefined();
    const walletEntry = sales!.children.find((child) => child.href === "/admin/gift-cards");
    expect(walletEntry).toBeDefined();
    expect(walletEntry!.label).toBe("Gift Cards");
  });

  it("Sales group contains coupon usage without replacing Gift Cards", () => {
    const sales = getGroup("sales");
    expect(sales).toBeDefined();
    const hrefs = sales!.children.map((child) => child.href);

    expect(hrefs).toContain("/admin/sales/coupons");
    expect(hrefs).toContain("/admin/sales/loyalty");
    expect(hrefs).toContain("/admin/gift-cards");
  });

  it("Catalog group still contains Booking Services, Plans, and Loyalty Points", () => {
    const catalog = getGroup("catalog");
    expect(catalog).toBeDefined();
    const hrefs = catalog!.children.map((child) => child.href);
    expect(hrefs).toContain("/admin/classes");
    expect(hrefs).toContain("/admin/plans");
    expect(hrefs).toContain("/admin/catalog/loyalty");
  });
});
