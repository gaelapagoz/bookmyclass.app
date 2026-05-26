import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("sign-in page service boundary", () => {
  it("uses sign-in-service and does not import db directly", async () => {
    const pagePath = path.resolve(process.cwd(), "src/app/(public)/sign-in/page.tsx");
    const source = await fs.readFile(pagePath, "utf8");

    expect(source).toContain('from "@/lib/auth/sign-in-service"');
    expect(source).not.toContain('from "@/lib/db"');
  });
});
