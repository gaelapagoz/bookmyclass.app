import "./helpers/setup-env";

import { hash } from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPublicAuthRateLimitForTests,
  confirmEmailChangeByToken,
  createPendingPublicRegistration,
  requestEmailChange,
  verifyPendingRegistrationByToken,
} from "../../src/lib/auth/user-identity-service";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

describe("user identity hardening", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await resetDb();
    await clearPublicAuthRateLimitForTests();

    process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || "test-resend-key";
    process.env.EMAIL_FROM = process.env.EMAIL_FROM || "Test <test@example.test>";
    process.env.APP_URL = process.env.APP_URL || "http://localhost:3000";

    fetchMock = vi.fn(async () => Response.json({ id: "email_1" }, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  function getTokenFromEmailCall(paramName: string): string {
    const firstCall = fetchMock.mock.calls[0];
    if (!firstCall) {
      throw new Error("Expected email call.");
    }

    const payload = JSON.parse(String((firstCall[1] as { body?: unknown })?.body ?? "{}")) as {
      html?: string;
    };
    const html = payload.html ?? "";
    const match = html.match(new RegExp(`${paramName}=([^"&]+)`));
    if (!match?.[1]) {
      throw new Error(`${paramName} not found in payload.`);
    }

    return decodeURIComponent(match[1]);
  }

  it("blocks honeypot-filled public signup", async () => {
    const email = `honeypot.${Date.now()}@example.test`;
    const result = await createPendingPublicRegistration({
      firstName: "Honey",
      lastName: "Pot",
      email,
      passwordHash: await hash("Password123!", 12),
      honeypot: "https://spam.example",
      ipAddress: "203.0.113.1",
      appUrl: "http://localhost:3000",
    });

    expect(result.outcome).toBe("BLOCKED_SPAM");
    const pending = await prisma.pendingUserRegistration.findUnique({ where: { email } });
    expect(pending).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rate limits public signup by email", async () => {
    const email = `rate-limit.${Date.now()}@example.test`;

    const first = await createPendingPublicRegistration({
      firstName: "Rate",
      lastName: "Limited",
      email,
      passwordHash: await hash("Password123!", 12),
      ipAddress: "203.0.113.2",
      appUrl: "http://localhost:3000",
    });

    const second = await createPendingPublicRegistration({
      firstName: "Rate",
      lastName: "Limited",
      email,
      passwordHash: await hash("Password123!", 12),
      ipAddress: "203.0.113.2",
      appUrl: "http://localhost:3000",
    });

    expect(first.outcome).toBe("PENDING_VERIFICATION");
    expect(second.outcome).toBe("RATE_LIMITED");
  });

  it("verifies pending registration exactly once", async () => {
    const email = `verify-once.${Date.now()}@example.test`;
    const created = await createPendingPublicRegistration({
      firstName: "Verify",
      lastName: "Once",
      email,
      passwordHash: await hash("Password123!", 12),
      ipAddress: "203.0.113.3",
      appUrl: "http://localhost:3000",
    });
    expect(created.outcome).toBe("PENDING_VERIFICATION");

    const token = getTokenFromEmailCall("registrationToken");
    const firstVerify = await verifyPendingRegistrationByToken({ token });
    expect(firstVerify.verified).toBe(true);

    const secondVerify = await verifyPendingRegistrationByToken({ token });
    expect(secondVerify.verified).toBe(false);

    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: {
        role: true,
        activationStatus: true,
        createdVia: true,
        createdIp: true,
      },
    });
    expect(user.role).toBe("CLIENT");
    expect(user.activationStatus).toBe("ACTIVE");
    expect(user.createdVia).toBe("PUBLIC_SIGNUP");
    expect(user.createdIp).toBe("203.0.113.3");
  });

  it("keeps email unchanged until email-change verification succeeds", async () => {
    const user = await prisma.user.create({
      data: {
        name: "Email Change",
        firstName: "Email",
        lastName: "Change",
        email: `email-change.${Date.now()}@example.test`,
        passwordHash: await hash("Password123!", 12),
        emailVerified: new Date(),
        emailVerifiedAt: new Date(),
      },
    });

    const newEmail = `email-change.new.${Date.now()}@example.test`;
    const request = await requestEmailChange({
      userId: user.id,
      newEmail,
      currentPassword: "Password123!",
      appUrl: "http://localhost:3000",
    });

    expect(request.outcome).toBe("SENT");

    const beforeConfirm = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { email: true, pendingEmail: true },
    });
    expect(beforeConfirm.email).toBe(user.email);
    expect(beforeConfirm.pendingEmail).toBe(newEmail);

    const token = getTokenFromEmailCall("emailChangeToken");
    const confirm = await confirmEmailChangeByToken({ token });
    expect(confirm.verified).toBe(true);

    const afterConfirm = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        email: true,
        pendingEmail: true,
        pendingEmailTokenHash: true,
        lastEmailChangeAt: true,
      },
    });

    expect(afterConfirm.email).toBe(newEmail);
    expect(afterConfirm.pendingEmail).toBeNull();
    expect(afterConfirm.pendingEmailTokenHash).toBeNull();
    expect(afterConfirm.lastEmailChangeAt).not.toBeNull();
  });
});
