import { describe, expect, it } from "vitest";

import { adminNavConfig, type AdminNavGroupItem } from "../../src/lib/navigation/admin-nav";

function getGroup(key: string): AdminNavGroupItem | undefined {
  return adminNavConfig.find(
    (item): item is AdminNavGroupItem => item.type === "group" && item.key === key,
  );
}

function isActive(href: string, pathname: string, matchPrefixes?: string[]) {
  if (pathname === href || pathname.startsWith(`${href}/`)) {
    return true;
  }

  return matchPrefixes?.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)) ?? false;
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

  it("Sales group contains coupon and loyalty activity without replacing Gift Cards", () => {
    const sales = getGroup("sales");
    expect(sales).toBeDefined();
    const hrefs = sales!.children.map((child) => child.href);

    expect(hrefs).toContain("/admin/sales/coupons");
    expect(hrefs).toContain("/admin/sales/loyalty");
    expect(hrefs).toContain("/admin/gift-cards");

    expect(sales!.children.find((child) => child.href === "/admin/sales/coupons")).toMatchObject({
      label: "Coupon Redemptions",
    });
    expect(sales!.children.find((child) => child.href === "/admin/sales/loyalty")).toMatchObject({
      label: "Loyalty Activity",
    });
  });

  it("Catalog group contains classes, memberships, coupons, loyalty, and store products", () => {
    const catalog = getGroup("catalog");
    expect(catalog).toBeDefined();
    expect(catalog!.children.map((child) => [child.href, child.label])).toEqual([
      ["/admin/classes", "Classes"],
      ["/admin/plans", "Memberships & Packs"],
      ["/admin/store", "Store Products"],
      ["/admin/coupons", "Coupons"],
      ["/admin/loyalty", "Loyalty Program"],
    ]);
  });

  it("Coupons catalog entry remains active for create and edit routes", () => {
    const catalog = getGroup("catalog");
    expect(catalog).toBeDefined();
    const coupons = catalog!.children.find((child) => child.href === "/admin/coupons");
    expect(coupons).toBeDefined();

    expect(isActive(coupons!.href, "/admin/coupons", coupons!.matchPrefixes)).toBe(true);
    expect(isActive(coupons!.href, "/admin/coupons/new", coupons!.matchPrefixes)).toBe(true);
    expect(isActive(coupons!.href, "/admin/coupons/cp_1/edit", coupons!.matchPrefixes)).toBe(true);
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

  it("Communications group uses canonical marketing routes and labels", () => {
    const communications = getGroup("communications");
    expect(communications).toBeDefined();

    expect(communications!.children.map((child) => [child.href, child.label])).toEqual([
      ["/admin/inbox", "Client Messages"],
      ["/admin/automations", "Email Automations"],
      ["/admin/campaigns", "Marketing Campaigns"],
      ["/admin/segments", "Marketing Segments"],
    ]);

    expect(communications!.children.map((child) => child.href)).not.toEqual(
      expect.arrayContaining([
        "/admin/catalog/loyalty",
        "/admin/marketing/campaigns",
        "/admin/marketing/segments",
      ]),
    );
  });

  it("Canonical child routes activate the matching admin navigation item", () => {
    const catalog = getGroup("catalog");
    const communications = getGroup("communications");
    expect(catalog).toBeDefined();
    expect(communications).toBeDefined();

    const loyalty = catalog!.children.find((child) => child.href === "/admin/loyalty");
    const campaigns = communications!.children.find((child) => child.href === "/admin/campaigns");
    const segments = communications!.children.find((child) => child.href === "/admin/segments");

    expect(isActive(loyalty!.href, "/admin/loyalty", loyalty!.matchPrefixes)).toBe(true);
    expect(isActive(campaigns!.href, "/admin/campaigns/new", campaigns!.matchPrefixes)).toBe(true);
    expect(isActive(campaigns!.href, "/admin/campaigns/camp-1/review", campaigns!.matchPrefixes)).toBe(true);
    expect(isActive(segments!.href, "/admin/segments", segments!.matchPrefixes)).toBe(true);
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
