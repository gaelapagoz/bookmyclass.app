import "./helpers/setup-env";

import { hash } from "bcryptjs";
import { beforeEach, describe, expect, it } from "vitest";

import { clearCapturedTestEmails, getCapturedTestEmails } from "@/lib/email/resend-delivery";
import {
  requestEmailVerification,
  verifyEmailByToken,
  clearPublicAuthRateLimitForTests,
  confirmEmailChangeByToken,
  createPendingPublicRegistration,
  requestEmailChange,
  verifyPendingRegistrationByToken,
} from "../../src/lib/auth/user-identity-service";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

function getTokenFromCapturedEmail(paramName: string, recipientEmail?: string): string {
  const outbox = [...getCapturedTestEmails()].reverse();
  const message = recipientEmail
    ? outbox.find((item) => item.to.includes(recipientEmail.toLowerCase()))
    : outbox[0];

  if (!message) {
    throw new Error("Expected email in test outbox.");
  }

  const match = message.html.match(new RegExp(`${paramName}=([^"&]+)`));
  if (!match?.[1]) {
    throw new Error(`${paramName} not found in captured payload.`);
  }

  return decodeURIComponent(match[1]);
}

describe("user identity hardening", () => {
  beforeEach(async () => {
    await resetDb();
    await clearPublicAuthRateLimitForTests();
    clearCapturedTestEmails();

    process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || "test-resend-key";
    process.env.EMAIL_FROM = process.env.EMAIL_FROM || "Test <test@example.test>";
    process.env.APP_URL = process.env.APP_URL || "http://localhost:3000";
  });

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
    expect(getCapturedTestEmails()).toHaveLength(0);
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

  it("queues verification outbox event even when immediate send attempt fails", async () => {
    const email = `verify.queue.${Date.now()}@example.test`;
    const originalNodeEnv = process.env.NODE_ENV;
    const originalApiKey = process.env.RESEND_API_KEY;
    const originalAllowRealEmails = process.env.ALLOW_REAL_EMAILS_IN_NON_PRODUCTION;
    process.env.NODE_ENV = "development";
    process.env.ALLOW_REAL_EMAILS_IN_NON_PRODUCTION = "1";
    delete process.env.RESEND_API_KEY;
    process.env.EMAIL_FROM = "Book My Class <no-reply@bookmyclass.app>";

    try {
      const result = await createPendingPublicRegistration({
        firstName: "Queue",
        lastName: "Verification",
        email,
        passwordHash: await hash("Password123!", 12),
        ipAddress: "203.0.113.88",
        appUrl: "http://localhost:3000",
      });

      expect(result.outcome).toBe("PENDING_VERIFICATION");
      const pending = await prisma.pendingUserRegistration.findUniqueOrThrow({
        where: { email },
        select: { tokenHash: true },
      });
      const event = await prisma.emailAutomationEvent.findUnique({
        where: {
          idempotencyKey: `auth.verify-email:registration:${email}:${pending.tokenHash}`,
        },
      });
      expect(event).not.toBeNull();
      expect(event?.status).toBe("PENDING");
    } finally {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
      if (originalApiKey === undefined) {
        delete process.env.RESEND_API_KEY;
      } else {
        process.env.RESEND_API_KEY = originalApiKey;
      }
      if (originalAllowRealEmails === undefined) {
        delete process.env.ALLOW_REAL_EMAILS_IN_NON_PRODUCTION;
      } else {
        process.env.ALLOW_REAL_EMAILS_IN_NON_PRODUCTION = originalAllowRealEmails;
      }
    }
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

    const token = getTokenFromCapturedEmail("registrationToken", email);
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

  it("uses APP_URL for signup verification links and normalizes trailing slashes", async () => {
    const email = `verify-url.${Date.now()}@example.test`;
    const result = await createPendingPublicRegistration({
      firstName: "Verify",
      lastName: "URL",
      email,
      passwordHash: await hash("Password123!", 12),
      ipAddress: "203.0.113.53",
      appUrl: "https://demo.bookmyclass.app/",
    });
    expect(result.outcome).toBe("PENDING_VERIFICATION");

    const message = getCapturedTestEmails().find((item) => item.to.includes(email.toLowerCase()));
    expect(message?.html).toContain("https://demo.bookmyclass.app/verify-email?");
    expect(message?.html).not.toContain("https://demo.bookmyclass.app//verify-email");
    expect(message?.html).toContain(`email=${encodeURIComponent(email)}`);
  });

  it("suppresses older signup verification emails after token rotation", async () => {
    const email = `verify-rotate.${Date.now()}@example.test`;
    const originalNodeEnv = process.env.NODE_ENV;
    const originalApiKey = process.env.RESEND_API_KEY;
    const originalAllowRealEmails = process.env.ALLOW_REAL_EMAILS_IN_NON_PRODUCTION;
    process.env.NODE_ENV = "development";
    process.env.ALLOW_REAL_EMAILS_IN_NON_PRODUCTION = "1";
    delete process.env.RESEND_API_KEY;
    process.env.EMAIL_FROM = "Book My Class <no-reply@bookmyclass.app>";

    try {
      const created = await createPendingPublicRegistration({
        firstName: "Rotate",
        lastName: "Signup",
        email,
        passwordHash: await hash("Password123!", 12),
        ipAddress: "203.0.113.77",
        appUrl: "https://demo.bookmyclass.app",
      });
      expect(created.outcome).toBe("PENDING_VERIFICATION");

      const firstPending = await prisma.pendingUserRegistration.findUniqueOrThrow({
        where: { email },
        select: { tokenHash: true },
      });
      const firstEvent = await prisma.emailAutomationEvent.findUniqueOrThrow({
        where: {
          idempotencyKey: `auth.verify-email:registration:${email}:${firstPending.tokenHash}`,
        },
        select: { id: true, status: true },
      });
      expect(firstEvent.status).toBe("PENDING");

      const resent = await requestEmailVerification({
        email,
        appUrl: "https://demo.bookmyclass.app",
        now: new Date(Date.now() + 61_000),
      });
      expect(resent.outcome).toBe("SENT");

      const staleAfterRotate = await prisma.emailAutomationEvent.findUniqueOrThrow({
        where: { id: firstEvent.id },
        select: { status: true, lastError: true },
      });
      expect(staleAfterRotate.status).toBe("DEAD_LETTER");
      expect(staleAfterRotate.lastError).toBe("AUTH_SECURITY_EMAIL_SUPERSEDED");

      const latestPending = await prisma.pendingUserRegistration.findUniqueOrThrow({
        where: { email },
        select: { tokenHash: true },
      });
      const latestEvent = await prisma.emailAutomationEvent.findUniqueOrThrow({
        where: {
          idempotencyKey: `auth.verify-email:registration:${email}:${latestPending.tokenHash}`,
        },
        select: { status: true, lastError: true },
      });
      expect(latestEvent.status).toBe("PENDING");
      expect(latestEvent.lastError).toBe("Missing RESEND_API_KEY.");
    } finally {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
      if (originalApiKey === undefined) {
        delete process.env.RESEND_API_KEY;
      } else {
        process.env.RESEND_API_KEY = originalApiKey;
      }
      if (originalAllowRealEmails === undefined) {
        delete process.env.ALLOW_REAL_EMAILS_IN_NON_PRODUCTION;
      } else {
        process.env.ALLOW_REAL_EMAILS_IN_NON_PRODUCTION = originalAllowRealEmails;
      }
    }
  });

  it("rejects pending-registration verification with invalid token", async () => {
    const result = await verifyPendingRegistrationByToken({ token: "not-a-valid-token" });
    expect(result).toEqual({ verified: false, email: null });
  });

  it("rejects pending-registration verification with expired token", async () => {
    const email = `verify-expired.${Date.now()}@example.test`;
    const created = await createPendingPublicRegistration({
      firstName: "Verify",
      lastName: "Expired",
      email,
      passwordHash: await hash("Password123!", 12),
      ipAddress: "203.0.113.31",
      appUrl: "http://localhost:3000",
    });
    expect(created.outcome).toBe("PENDING_VERIFICATION");

    const token = getTokenFromCapturedEmail("registrationToken", email);
    const expired = await verifyPendingRegistrationByToken({
      token,
      now: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000),
    });
    expect(expired.verified).toBe(false);

    const user = await prisma.user.findFirst({ where: { email } });
    expect(user).toBeNull();
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

    const token = getTokenFromCapturedEmail("emailChangeToken", newEmail);
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

  it("rejects reused email-change verification token", async () => {
    const user = await prisma.user.create({
      data: {
        name: "Email Change Reuse",
        firstName: "Email",
        lastName: "Reuse",
        email: `email-change.reuse.${Date.now()}@example.test`,
        passwordHash: await hash("Password123!", 12),
        emailVerified: new Date(),
        emailVerifiedAt: new Date(),
      },
    });

    const newEmail = `email-change.reuse.new.${Date.now()}@example.test`;
    const request = await requestEmailChange({
      userId: user.id,
      newEmail,
      currentPassword: "Password123!",
      appUrl: "http://localhost:3000",
    });
    expect(request.outcome).toBe("SENT");

    const token = getTokenFromCapturedEmail("emailChangeToken", newEmail);
    const firstConfirm = await confirmEmailChangeByToken({ token });
    const secondConfirm = await confirmEmailChangeByToken({ token });

    expect(firstConfirm.verified).toBe(true);
    expect(secondConfirm.verified).toBe(false);
  });

  it("rejects expired email verification token", async () => {
    const email = `verify-user.expired.${Date.now()}@example.test`;
    const user = await prisma.user.create({
      data: {
        name: "Verify Expired",
        firstName: "Verify",
        lastName: "Expired",
        email,
        passwordHash: await hash("Password123!", 12),
        emailVerified: null,
      },
    });

    const outcome = await requestEmailVerification({
      email,
      appUrl: "http://localhost:3000",
      now: new Date(),
    });
    expect(outcome.outcome).toBe("SENT");

    const token = getTokenFromCapturedEmail("token", email);
    const verified = await verifyEmailByToken({
      email,
      token,
      now: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000),
    });
    expect(verified).toBe(false);

    const unchangedUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { emailVerified: true },
    });
    expect(unchangedUser.emailVerified).toBeNull();
  });

  it("rejects email verification with invalid token", async () => {
    const email = `verify-user.invalid.${Date.now()}@example.test`;
    await prisma.user.create({
      data: {
        name: "Verify Invalid",
        firstName: "Verify",
        lastName: "Invalid",
        email,
        passwordHash: await hash("Password123!", 12),
        emailVerified: null,
      },
    });

    const verified = await verifyEmailByToken({
      email,
      token: "invalid-token",
    });
    expect(verified).toBe(false);
  });

  it("verifies email token once and safely rejects replay", async () => {
    const email = `verify-user.replay.${Date.now()}@example.test`;
    await prisma.user.create({
      data: {
        name: "Verify Replay",
        firstName: "Verify",
        lastName: "Replay",
        email,
        passwordHash: await hash("Password123!", 12),
        emailVerified: null,
      },
    });

    const outcome = await requestEmailVerification({
      email,
      appUrl: "http://localhost:3000",
      now: new Date(),
    });
    expect(outcome.outcome).toBe("SENT");

    const token = getTokenFromCapturedEmail("token", email);
    const first = await verifyEmailByToken({ email, token });
    const second = await verifyEmailByToken({ email, token });

    expect(first).toBe(true);
    expect(second).toBe(false);
  });
});
