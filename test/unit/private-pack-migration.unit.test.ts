import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("private-pack product type migration", () => {
  it("renames PRIVATE_CLASS and migrates private-scope class packs", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "prisma/migrations/20260425113000_private_pack_product_type/migration.sql"),
      "utf8",
    );

    expect(sql).toContain(`ALTER TYPE "ProductType" RENAME VALUE 'PRIVATE_CLASS' TO 'PRIVATE_PACK';`);
    expect(sql).toContain(`SET "productType" = 'PRIVATE_PACK'`);
    expect(sql).toContain(`AND p."productType" = 'CLASS_PACK'`);
    expect(sql).toContain(`AND er."entitlementScope" = 'PRIVATE_CLASSES'`);
  });
});
