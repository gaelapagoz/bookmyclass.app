import "./helpers/setup-env";

import { hash } from "bcryptjs";
import { Role } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { captureMessageMock } = vi.hoisted(() => ({
  captureMessageMock: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  withScope: (
    callback: (scope: { setTag: (key: string, value: string) => void; setExtra: (key: string, value: unknown) => void }) => void,
  ) => callback({ setTag: () => undefined, setExtra: () => undefined }),
  captureMessage: captureMessageMock,
}));

import { authorizeCredentials } from "../../src/lib/auth/credentials-authorize";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

describe("credentials authorize integration", () => {
  beforeEach(async () => {
    await resetDb();
    captureMessageMock.mockReset();
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
        emailVerified: new Date(),
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
        emailVerified: new Date(),
      },
    });

    const result = await authorizeCredentials({
      email: "auth.client@example.test",
      password: "WrongPass123!",
    });

    expect(result).toBeNull();
  });

  it("rejects unverified users even with correct password", async () => {
    const password = "Password123!";
    const passwordHash = await hash(password, 12);

    await prisma.user.create({
      data: {
        name: "Auth Client",
        firstName: "Auth",
        lastName: "Client",
        email: "unverified.auth.client@example.test",
        role: Role.CLIENT,
        passwordHash,
        emailVerified: null,
      },
    });

    const result = await authorizeCredentials({
      email: "unverified.auth.client@example.test",
      password,
    });

    expect(result).toBeNull();
  });

  it("accepts unverified admin users with valid credentials", async () => {
    const password = "Password123!";
    const passwordHash = await hash(password, 12);

    const user = await prisma.user.create({
      data: {
        name: "Unverified Admin",
        firstName: "Unverified",
        lastName: "Admin",
        email: "unverified.admin@example.test",
        role: Role.ADMIN,
        passwordHash,
        emailVerified: null,
      },
    });

    const result = await authorizeCredentials({
      email: "unverified.admin@example.test",
      password,
    });

    expect(result).not.toBeNull();
    expect(result?.id).toBe(user.id);
    expect(result?.role).toBe(Role.ADMIN);
  });

  it("blocks repeated failed attempts via credentials rate limiter", async () => {
    const email = `rate-limit.${Date.now()}@example.test`;
    const password = "Password123!";
    const passwordHash = await hash(password, 12);

    await prisma.user.create({
      data: {
        name: "Rate Limited User",
        firstName: "Rate",
        lastName: "Limited",
        email,
        role: Role.CLIENT,
        passwordHash,
        emailVerified: new Date(),
      },
    });

    const request = {
      headers: new Headers({
        "x-forwarded-for": "203.0.113.10",
      }),
    };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await authorizeCredentials(
        {
          email,
          password: "WrongPass123!",
        },
        request,
      );
      expect(result).toBeNull();
    }

    const blockedResult = await authorizeCredentials(
      {
        email,
        password,
      },
      request,
    );

    expect(blockedResult).toBeNull();
    expect(captureMessageMock).toHaveBeenCalledWith("rate_limit_triggered");
  });
});
