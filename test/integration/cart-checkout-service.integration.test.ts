import "./helpers/setup-env";

import { Role, UserActivationStatus } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { startCartCheckout } from "../../src/lib/cart/cart-checkout-service";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

describe("cart checkout service actor eligibility", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("rejects non-client actors before cart resolution", async () => {
    const admin = await prisma.user.create({
      data: {
        name: "Admin",
        email: `cart.admin.${Date.now()}@example.test`,
        role: Role.ADMIN,
      },
      select: { id: true },
    });

    const response = await startCartCheckout({
      userId: admin.id,
      idempotencyKey: `cart_service_non_client_${Date.now()}`,
      clientCartVersion: "v1",
      lines: [],
    });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("EMAIL_VERIFICATION_REQUIRED");
  });

  it("rejects inactive clients before cart resolution", async () => {
    const client = await prisma.user.create({
      data: {
        name: "Inactive Client",
        email: `cart.inactive.${Date.now()}@example.test`,
        role: Role.CLIENT,
        activationStatus: UserActivationStatus.DISABLED,
      },
      select: { id: true },
    });

    const response = await startCartCheckout({
      userId: client.id,
      idempotencyKey: `cart_service_inactive_${Date.now()}`,
      clientCartVersion: "v1",
      lines: [],
    });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("EMAIL_VERIFICATION_REQUIRED");
  });
});