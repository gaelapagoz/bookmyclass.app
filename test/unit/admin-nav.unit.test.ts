import { describe, expect, it } from "vitest";

import { adminNavConfig, type AdminNavGroupItem } from "../../src/lib/navigation/admin-nav";

function getGroup(key: string): AdminNavGroupItem | undefined {
  return adminNavConfig.find(
    (item): item is AdminNavGroupItem => item.type === "group" && item.key === key,
  );
}

describe("adminNavConfig - Store navigation structure", () => {
  it("Catalog group contains one Store Products entry", () => {
    const catalog = getGroup("catalog");
    expect(catalog).toBeDefined();

    const storeEntries = catalog!.children.filter((child) => child.label.startsWith("Store"));

    expect(storeEntries).toHaveLength(1);
    expect(storeEntries[0]).toMatchObject({
      href: "/admin/store",
      label: "Store Products",
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

  it("Catalog group contains Classes and Memberships & Packs only once", () => {
    const catalog = getGroup("catalog");
    expect(catalog).toBeDefined();
    expect(catalog!.children.map((child) => [child.href, child.label])).toEqual([
      ["/admin/classes", "Classes"],
      ["/admin/plans", "Memberships & Packs"],
      ["/admin/store", "Store Products"],
    ]);
  });

  it("Communications group preserves inbox badge under Client Messages", () => {
    const communications = getGroup("communications");
    expect(communications).toBeDefined();
    expect(communications!.children[0]).toMatchObject({
      href: "/admin/inbox",
      label: "Client Messages",
      badgeKey: "inboxUnread",
    });
  });

  it("Content group maps website and video library routes", () => {
    const content = getGroup("content");
    expect(content).toBeDefined();
    expect(content!.children.map((child) => [child.href, child.label])).toEqual([
      ["/admin/manage-site", "Website Content"],
      ["/admin/online-learning", "Video Library"],
    ]);
  });
});
