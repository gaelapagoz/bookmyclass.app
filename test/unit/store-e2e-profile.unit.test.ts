import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Store E2E profile", () => {
  it("runs the Store-tagged Playwright subset", () => {
    const packageJson = JSON.parse(readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["test:e2e:store"]).toBe("playwright test --grep @store");
  });

  it("has critical Store tests tagged for the Store profile", () => {
    const storeSpec = readFileSync(path.resolve(process.cwd(), "test/e2e/store.spec.ts"), "utf8");

    expect(storeSpec).toContain("@store");
    expect(storeSpec).toContain("@covers store-gift-card-purchase-flow");
    expect(storeSpec).toContain("@covers store-gift-card-redeem-code");
  });
});
