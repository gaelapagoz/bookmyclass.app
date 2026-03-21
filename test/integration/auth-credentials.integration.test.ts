import "./helpers/setup-env";

import { hash } from "bcryptjs";
import { Role } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { authorizeCredentials } from "../../src/lib/auth/credentials-authorize";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

describe("credentials authorize integration", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("accepts valid credentials", async () => {
    const password = "Password123!";
    const passwordHash = await hash(password, 12);

    const user = await prisma.user.create({
      data: {
        name: "Auth Client",
        firstName: "Auth",
        lastName: "Client",
        email: "auth.client@example.test",
        role: Role.CLIENT,
        passwordHash,
      },
    });

    const result = await authorizeCredentials({
      email: "auth.client@example.test",
      password,
    });

    expect(result).not.toBeNull();
    expect(result?.id).toBe(user.id);
    expect(result?.email).toBe(user.email);
  });

  it("rejects invalid credentials", async () => {
    const passwordHash = await hash("Password123!", 12);

    await prisma.user.create({
      data: {
        name: "Auth Client",
        firstName: "Auth",
        lastName: "Client",
        email: "auth.client@example.test",
        role: Role.CLIENT,
        passwordHash,
      },
    });

    const result = await authorizeCredentials({
      email: "auth.client@example.test",
      password: "WrongPass123!",
    });

    expect(result).toBeNull();
  });
});
