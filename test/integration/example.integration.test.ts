import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createClient } from "./helpers/factories";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

describe("integration example", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a client user", async () => {
    const created = await createClient(prisma);

    const found = await prisma.user.findUnique({ where: { id: created.id } });

    expect(found).toBeTruthy();
    expect(found?.email).toBe(created.email);
  });
});
