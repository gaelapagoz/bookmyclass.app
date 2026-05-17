import "./helpers/setup-env";

import { hash } from "bcryptjs";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { dispatchEmailAutomationBatch } from "@/lib/email/email-automation-dispatcher-service";
import { clearCapturedTestEmails, getCapturedTestEmails } from "@/lib/email/resend-delivery";
import {
  requestEmailChange,
  requestEmailVerification,
} from "@/lib/auth/user-identity-service";
import { requestPasswordReset } from "@/lib/auth/password-service";
import { resetDb } from "./helpers/reset-db";

function latestSubjectFor(recipientEmail: string): string {
  const message = [...getCapturedTestEmails()]
    .reverse()
    .find((entry) => entry.to.includes(recipientEmail.toLowerCase()));
  if (!message) {
    throw new Error(`Expected captured email for ${recipientEmail}`);
  }
  return message.subject;
}

describe("auth email fast lane", () => {
  beforeEach(async () => {
    await resetDb();
    clearCapturedTestEmails();
  });

  it("keeps verification subject isolated from email-change subject", async () => {
    const verifyUserEmail = `verify-subject.${Date.now()}@example.test`;
    await prisma.user.create({
      data: {
        name: "Verify Subject",
        firstName: "Verify",
        lastName: "Subject",
        email: verifyUserEmail,
        passwordHash: await hash("Password123!", 12),
        emailVerified: null,
      },
    });

    const verifyOutcome = await requestEmailVerification({ email: verifyUserEmail, appUrl: "http://localhost:3000" });
    expect(verifyOutcome.outcome).toBe("SENT");
    expect(latestSubjectFor(verifyUserEmail)).toBe("Verify your email");

    const changeUser = await prisma.user.create({
      data: {
        name: "Email Change Subject",
        firstName: "Email",
        lastName: "Change",
        email: `email-change-subject.${Date.now()}@example.test`,
        passwordHash: await hash("Password123!", 12),
        emailVerified: new Date(),
        emailVerifiedAt: new Date(),
      },
    });
    const newEmail = `email-change-target.${Date.now()}@example.test`;
    const changeOutcome = await requestEmailChange({
      userId: changeUser.id,
      newEmail,
      currentPassword: "Password123!",
      appUrl: "http://localhost:3000",
    });
    expect(changeOutcome.outcome).toBe("SENT");
    expect(latestSubjectFor(newEmail)).toBe("Confirm your new email");

    const secondVerifyEmail = `verify-subject-second.${Date.now()}@example.test`;
    await prisma.user.create({
      data: {
        name: "Verify Subject Second",
        firstName: "Verify",
        lastName: "Second",
        email: secondVerifyEmail,
        passwordHash: await hash("Password123!", 12),
        emailVerified: null,
      },
    });
    const secondVerifyOutcome = await requestEmailVerification({ email: secondVerifyEmail, appUrl: "http://localhost:3000" });
    expect(secondVerifyOutcome.outcome).toBe("SENT");
    expect(latestSubjectFor(secondVerifyEmail)).toBe("Verify your email");
  });

  it("persists outbox event, records failed immediate attempt, and allows cron fallback pickup", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalResendApiKey = process.env.RESEND_API_KEY;
    const originalEmailFrom = process.env.EMAIL_FROM;
    process.env.NODE_ENV = "development";
    delete process.env.RESEND_API_KEY;
    process.env.EMAIL_FROM = "Book My Class <no-reply@bookmyclass.app>";

    try {
      const user = await prisma.user.create({
        data: {
          name: "Cron Fallback",
          firstName: "Cron",
          lastName: "Fallback",
          email: `cron-fallback.${Date.now()}@example.test`,
          passwordHash: await hash("Password123!", 12),
          emailVerified: new Date(),
          emailVerifiedAt: new Date(),
        },
      });

      const outcome = await requestPasswordReset({
        email: user.email,
        appUrl: "http://localhost:3000",
      });
      expect(outcome.outcome).toBe("SENT");

      const event = await prisma.emailAutomationEvent.findFirstOrThrow({
        where: { recipientEmail: user.email.toLowerCase() },
      });
      expect(event.attempts).toBe(1);
      expect(event.status).toBe("PENDING");

      const attemptsAfterImmediate = await prisma.emailAutomationAttempt.count({
        where: { eventId: event.id },
      });
      expect(attemptsAfterImmediate).toBe(1);

      await prisma.emailAutomationEvent.update({
        where: { id: event.id },
        data: { maxAttempts: 2 },
      });

      const cronRun = await dispatchEmailAutomationBatch({
        workerId: "cron-fallback-e4",
        maxEvents: 10,
        leaseMs: 30_000,
        now: new Date(Date.now() + 120_000),
      });
      expect(cronRun.failedCount).toBeGreaterThanOrEqual(1);

      const afterCron = await prisma.emailAutomationEvent.findUniqueOrThrow({
        where: { id: event.id },
      });
      expect(afterCron.status).toBe("DEAD_LETTER");

      const attemptsAfterCron = await prisma.emailAutomationAttempt.count({
        where: { eventId: event.id },
      });
      expect(attemptsAfterCron).toBe(2);
    } finally {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
      if (originalResendApiKey === undefined) {
        delete process.env.RESEND_API_KEY;
      } else {
        process.env.RESEND_API_KEY = originalResendApiKey;
      }
      if (originalEmailFrom === undefined) {
        delete process.env.EMAIL_FROM;
      } else {
        process.env.EMAIL_FROM = originalEmailFrom;
      }
    }
  });
});
