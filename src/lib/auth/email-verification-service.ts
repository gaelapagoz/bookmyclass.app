import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const EMAIL_VERIFICATION_RATE_LIMIT_WINDOW_MS = 60 * 1000;

export class EmailVerificationError extends Error {
  constructor(message: string) {
    super(message);
  }
}

function hashVerificationRateLimitKey(email: string): string {
  return createHash("sha256")
    .update(`email-verification-rate-limit:${email}`)
    .digest("hex");
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function shouldRateLimitVerificationRequest(email: string, now: Date): Promise<boolean> {
  const emailHash = hashVerificationRateLimitKey(email);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.passwordResetRateLimit.findUnique({
      where: { emailHash },
      select: { lastRequestedAt: true },
    });

    if (
      existing &&
      now.getTime() - existing.lastRequestedAt.getTime() < EMAIL_VERIFICATION_RATE_LIMIT_WINDOW_MS
    ) {
      return true;
    }

    await tx.passwordResetRateLimit.upsert({
      where: { emailHash },
      update: { lastRequestedAt: now },
      create: { emailHash, lastRequestedAt: now },
    });

    return false;
  });
}

async function sendVerificationEmail(params: {
  to: string;
  verificationUrl: string;
  name: string;
}) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (!apiKey || !from) {
    throw new EmailVerificationError("Missing RESEND_API_KEY or EMAIL_FROM.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [params.to],
      subject: "Verify your email",
      html: `
        <p>Hello ${params.name},</p>
        <p>Please verify your email to access your dashboard.</p>
        <p><a href="${params.verificationUrl}">Verify email</a></p>
        <p>This link expires in 24 hours.</p>
      `,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    console.error("[email-verification] resend-send-failed", {
      status: response.status,
      statusText: response.statusText,
      details,
    });
    throw new EmailVerificationError("Could not send verification email.");
  }
}

export async function requestEmailVerification(input: {
  email: string;
  appUrl?: string;
  now?: Date;
}): Promise<{ outcome: "SENT" | "SKIPPED" | "RATE_LIMITED" }> {
  const now = input.now ?? new Date();
  const email = normalizeEmail(input.email);
  if (!email) {
    return { outcome: "SKIPPED" };
  }

  const rateLimited = await shouldRateLimitVerificationRequest(email, now);
  if (rateLimited) {
    return { outcome: "RATE_LIMITED" };
  }

  const user = await prisma.user.findFirst({
    where: {
      email: {
        equals: email,
        mode: "insensitive",
      },
    },
    select: {
      id: true,
      email: true,
      name: true,
      emailVerified: true,
    },
  });

  if (!user || user.emailVerified) {
    return { outcome: "SKIPPED" };
  }

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MS);

  await prisma.$transaction([
    prisma.verificationToken.deleteMany({
      where: {
        identifier: user.email,
      },
    }),
    prisma.verificationToken.create({
      data: {
        identifier: user.email,
        token: tokenHash,
        expires: expiresAt,
      },
    }),
  ]);

  const appUrl = input.appUrl ?? process.env.APP_URL ?? "http://localhost:3000";
  const verificationUrl = `${appUrl.replace(/\/$/, "")}/verify-email?email=${encodeURIComponent(user.email)}&token=${encodeURIComponent(rawToken)}`;

  await sendVerificationEmail({
    to: user.email,
    verificationUrl,
    name: user.name,
  });

  return { outcome: "SENT" };
}

export async function verifyEmailByToken(input: { email: string; token: string; now?: Date }): Promise<boolean> {
  const now = input.now ?? new Date();
  const email = normalizeEmail(input.email);
  const token = input.token.trim();

  if (!email || !token) {
    return false;
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const verificationToken = await prisma.verificationToken.findUnique({
    where: {
      identifier_token: {
        identifier: email,
        token: tokenHash,
      },
    },
    select: {
      identifier: true,
      expires: true,
    },
  });

  if (!verificationToken || verificationToken.expires <= now) {
    return false;
  }

  await prisma.$transaction([
    prisma.user.updateMany({
      where: {
        email: {
          equals: verificationToken.identifier,
          mode: "insensitive",
        },
      },
      data: {
        emailVerified: now,
      },
    }),
    prisma.verificationToken.deleteMany({
      where: { identifier: verificationToken.identifier },
    }),
  ]);

  return true;
}
