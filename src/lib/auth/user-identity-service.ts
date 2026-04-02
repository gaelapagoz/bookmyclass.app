import { createHash, randomBytes } from "node:crypto";
import { Role, UserActivationStatus, UserCreatedVia } from "@prisma/client";
import { verifyPassword } from "@/lib/auth/password-service";
import { prisma } from "@/lib/db";

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const SIGNUP_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const EMAIL_CHANGE_RATE_LIMIT_WINDOW_MS = 60 * 1000;

const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "10minutemail.com",
  "mailinator.com",
  "guerrillamail.com",
  "tempmail.com",
  "yopmail.com",
  "trashmail.com",
  "maildrop.cc",
  "sharklasers.com",
  "getnada.com",
  "dispostable.com",
]);

export type PublicSignupCreateResult =
  | { outcome: "PENDING_VERIFICATION"; email: string }
  | { outcome: "RATE_LIMITED"; email: string }
  | { outcome: "BLOCKED_SPAM"; email: string }
  | { outcome: "BLOCKED_DISPOSABLE"; email: string }
  | { outcome: "SKIPPED"; email: string };

export class UserIdentityError extends Error {
  constructor(
    public readonly code:
      | "INVALID_INPUT"
      | "EMAIL_ALREADY_IN_USE"
      | "EMAIL_CHANGE_REQUIRES_PASSWORD"
      | "INVALID_CURRENT_PASSWORD"
      | "DISPOSABLE_EMAIL_BLOCKED"
      | "RATE_LIMITED",
    message: string,
  ) {
    super(message);
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeIpAddress(ipAddress: string | null | undefined): string {
  const normalized = ipAddress?.trim();
  return normalized && normalized.length > 0 ? normalized : "unknown";
}

function toFullName(firstName: string, lastName: string): string {
  return `${firstName.trim()} ${lastName.trim()}`.trim();
}

function hashRateLimitKey(key: string): string {
  return createHash("sha256").update(`public-auth-rate-limit:${key}`).digest("hex");
}

function hashVerificationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function isDisposableEmail(email: string): boolean {
  const domain = email.split("@")[1] ?? "";
  return DISPOSABLE_EMAIL_DOMAINS.has(domain);
}

function getVerificationDelegateOrThrow() {
  const delegate = (prisma as unknown as { pendingUserRegistration?: unknown }).pendingUserRegistration;
  if (!delegate) {
    throw new Error(
      "PendingUserRegistration Prisma delegate is unavailable. Run `npx prisma generate`, apply migrations, and restart the Next.js server.",
    );
  }
  return delegate as {
    upsert: typeof prisma.pendingUserRegistration.upsert;
    findFirst: typeof prisma.pendingUserRegistration.findFirst;
    findUnique: typeof prisma.pendingUserRegistration.findUnique;
    update: typeof prisma.pendingUserRegistration.update;
    updateMany: typeof prisma.pendingUserRegistration.updateMany;
  };
}

function getPublicAuthRateLimitDelegateOrThrow() {
  const delegate = (prisma as unknown as { publicAuthRateLimit?: unknown }).publicAuthRateLimit;
  if (!delegate) {
    throw new Error(
      "PublicAuthRateLimit Prisma delegate is unavailable. Run `npx prisma generate`, apply migrations, and restart the Next.js server.",
    );
  }
  return delegate as {
    findUnique: typeof prisma.publicAuthRateLimit.findUnique;
    upsert: typeof prisma.publicAuthRateLimit.upsert;
    deleteMany: typeof prisma.publicAuthRateLimit.deleteMany;
  };
}

async function sendVerificationEmail(params: {
  to: string;
  verificationUrl: string;
  name: string;
  subject?: string;
}) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (!apiKey || !from) {
    throw new Error("Missing RESEND_API_KEY or EMAIL_FROM.");
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
      subject: params.subject ?? "Verify your email",
      html: `
        <p>Hello ${params.name},</p>
        <p>Please verify your email to continue.</p>
        <p><a href="${params.verificationUrl}">Verify email</a></p>
        <p>This link expires in 24 hours.</p>
      `,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    console.error("[user-identity] resend-send-failed", {
      status: response.status,
      statusText: response.statusText,
      details,
    });
    throw new Error("Could not send verification email.");
  }
}

async function shouldRateLimit(key: string, now: Date, windowMs: number): Promise<boolean> {
  getPublicAuthRateLimitDelegateOrThrow();
  const keyHash = hashRateLimitKey(key);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.publicAuthRateLimit.findUnique({
      where: { keyHash },
      select: { lastRequestedAt: true },
    });

    if (existing && now.getTime() - existing.lastRequestedAt.getTime() < windowMs) {
      return true;
    }

    await tx.publicAuthRateLimit.upsert({
      where: { keyHash },
      update: { lastRequestedAt: now },
      create: {
        keyHash,
        lastRequestedAt: now,
      },
    });

    return false;
  });
}

async function storePendingRegistrationAndSend(params: {
  firstName: string;
  lastName: string;
  email: string;
  passwordHash: string;
  ipAddress: string;
  now: Date;
  appUrl?: string;
}) {
  const pendingRegistration = getVerificationDelegateOrThrow();
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashVerificationToken(rawToken);
  const tokenExpiresAt = new Date(params.now.getTime() + VERIFICATION_TTL_MS);

  await pendingRegistration.upsert({
    where: { email: params.email },
    update: {
      firstName: params.firstName,
      lastName: params.lastName,
      passwordHash: params.passwordHash,
      role: Role.CLIENT,
      createdVia: UserCreatedVia.PUBLIC_SIGNUP,
      createdIp: params.ipAddress,
      tokenHash,
      tokenExpiresAt,
      consumedAt: null,
      userId: null,
    },
    create: {
      email: params.email,
      firstName: params.firstName,
      lastName: params.lastName,
      passwordHash: params.passwordHash,
      role: Role.CLIENT,
      createdVia: UserCreatedVia.PUBLIC_SIGNUP,
      createdIp: params.ipAddress,
      tokenHash,
      tokenExpiresAt,
    },
  });

  const appUrl = params.appUrl ?? process.env.APP_URL ?? "http://localhost:3000";
  const verificationUrl = `${appUrl.replace(/\/$/, "")}/verify-email?registrationToken=${encodeURIComponent(rawToken)}&email=${encodeURIComponent(params.email)}`;

  await sendVerificationEmail({
    to: params.email,
    verificationUrl,
    name: toFullName(params.firstName, params.lastName) || params.firstName,
  });

  console.info("[user-identity] registration_verification_sent", { email: params.email });
}

async function syncEmailVerificationState(input: {
  userId: string;
  verifiedAt: Date | null;
}) {
  await prisma.user.update({
    where: { id: input.userId },
    data: {
      emailVerified: input.verifiedAt,
      emailVerifiedAt: input.verifiedAt,
    },
  });
}

export async function clearPublicAuthRateLimitForTests(): Promise<void> {
  const delegate = getPublicAuthRateLimitDelegateOrThrow();
  await delegate.deleteMany();
}

export async function createUserFromTrustedFlow(input: {
  firstName: string;
  lastName: string;
  email: string;
  passwordHash?: string | null;
  role: Role;
  createdVia: UserCreatedVia;
  createdByUserId?: string | null;
  createdIp?: string | null;
  activationStatus?: UserActivationStatus;
  isActive?: boolean;
  markEmailVerified?: boolean;
}) {
  const email = normalizeEmail(input.email);
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const name = toFullName(firstName, lastName) || "User";

  if (!email || !firstName || !lastName) {
    throw new UserIdentityError("INVALID_INPUT", "Invalid user input.");
  }

  const now = new Date();
  const activationStatus = input.activationStatus ?? UserActivationStatus.ACTIVE;
  const isActive = input.isActive ?? activationStatus !== UserActivationStatus.DISABLED;
  const verifiedAt = input.markEmailVerified ? now : null;

  return prisma.user.create({
    data: {
      name,
      firstName,
      lastName,
      email,
      passwordHash: input.passwordHash ?? null,
      role: input.role,
      isActive,
      isInactive: !isActive,
      createdVia: input.createdVia,
      createdByUserId: input.createdByUserId ?? null,
      createdIp: normalizeIpAddress(input.createdIp),
      activationStatus,
      emailVerified: verifiedAt,
      emailVerifiedAt: verifiedAt,
    },
  });
}

export async function createPendingPublicRegistration(input: {
  firstName: string;
  lastName: string;
  email: string;
  passwordHash: string;
  honeypot?: string | null;
  ipAddress?: string | null;
  appUrl?: string;
  now?: Date;
}): Promise<PublicSignupCreateResult> {
  const now = input.now ?? new Date();
  const email = normalizeEmail(input.email);
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const honeypot = input.honeypot?.trim();
  const ipAddress = normalizeIpAddress(input.ipAddress);

  if (!firstName || !lastName || !email || !input.passwordHash) {
    throw new UserIdentityError("INVALID_INPUT", "Invalid registration input.");
  }

  if (honeypot) {
    console.info("[user-identity] signup_honeypot_blocked", { ipAddress });
    return { outcome: "BLOCKED_SPAM", email };
  }

  if (isDisposableEmail(email)) {
    console.info("[user-identity] signup_disposable_blocked", { email, ipAddress });
    return { outcome: "BLOCKED_DISPOSABLE", email };
  }

  const [rateLimitedByEmail, rateLimitedByIp] = await Promise.all([
    shouldRateLimit(`signup:email:${email}`, now, SIGNUP_RATE_LIMIT_WINDOW_MS),
    shouldRateLimit(`signup:ip:${ipAddress}`, now, SIGNUP_RATE_LIMIT_WINDOW_MS),
  ]);

  if (rateLimitedByEmail || rateLimitedByIp) {
    console.info("[user-identity] signup_rate_limited", { email, ipAddress });
    return { outcome: "RATE_LIMITED", email };
  }

  const existingUser = await prisma.user.findFirst({
    where: {
      email: {
        equals: email,
        mode: "insensitive",
      },
    },
    select: { id: true },
  });

  if (existingUser) {
    await requestEmailVerification({
      email,
      appUrl: input.appUrl,
      now,
    }).catch((error) => {
      console.error("[user-identity] existing-user-verification-send-failed", {
        email,
        errorName: error instanceof Error ? error.name : null,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    });
    console.info("[user-identity] signup_existing_user_skipped", { email, ipAddress });
    return { outcome: "SKIPPED", email };
  }

  await storePendingRegistrationAndSend({
    firstName,
    lastName,
    email,
    passwordHash: input.passwordHash,
    ipAddress,
    now,
    appUrl: input.appUrl,
  });

  console.info("[user-identity] registration_created", { email, ipAddress });
  return { outcome: "PENDING_VERIFICATION", email };
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

  const rateLimited = await shouldRateLimit(`verify:email:${email}`, now, SIGNUP_RATE_LIMIT_WINDOW_MS);
  if (rateLimited) {
    console.info("[user-identity] verify_rate_limited", { email });
    return { outcome: "RATE_LIMITED" };
  }

  const pendingRegistration = await prisma.pendingUserRegistration.findUnique({
    where: { email },
    select: {
      email: true,
      firstName: true,
      lastName: true,
      passwordHash: true,
      consumedAt: true,
    },
  });

  if (pendingRegistration && !pendingRegistration.consumedAt) {
    await storePendingRegistrationAndSend({
      firstName: pendingRegistration.firstName,
      lastName: pendingRegistration.lastName,
      email: pendingRegistration.email,
      passwordHash: pendingRegistration.passwordHash,
      ipAddress: "unknown",
      now,
      appUrl: input.appUrl,
    });
    return { outcome: "SENT" };
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
      activationStatus: true,
    },
  });

  if (!user || (user.emailVerified && user.activationStatus === UserActivationStatus.ACTIVE)) {
    return { outcome: "SKIPPED" };
  }

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashVerificationToken(rawToken);
  const expiresAt = new Date(now.getTime() + VERIFICATION_TTL_MS);

  await prisma.$transaction([
    prisma.verificationToken.deleteMany({ where: { identifier: user.email } }),
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

  console.info("[user-identity] verification_sent", { email: user.email });
  return { outcome: "SENT" };
}

export async function verifyEmailByToken(input: {
  email: string;
  token: string;
  now?: Date;
}): Promise<boolean> {
  const now = input.now ?? new Date();
  const email = normalizeEmail(input.email);
  const token = input.token.trim();

  if (!email || !token) {
    return false;
  }

  const tokenHash = hashVerificationToken(token);
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

  const updated = await prisma.user.updateMany({
    where: {
      email: {
        equals: verificationToken.identifier,
        mode: "insensitive",
      },
    },
    data: {
      emailVerified: now,
      emailVerifiedAt: now,
      activationStatus: UserActivationStatus.ACTIVE,
      isActive: true,
      isInactive: false,
    },
  });

  await prisma.verificationToken.deleteMany({ where: { identifier: verificationToken.identifier } });
  console.info("[user-identity] verification_completed", { email: verificationToken.identifier, updated: updated.count });

  return updated.count > 0;
}

export async function verifyPendingRegistrationByToken(input: {
  token: string;
  now?: Date;
}): Promise<{ verified: boolean; email: string | null }> {
  const now = input.now ?? new Date();
  const token = input.token.trim();
  if (!token) {
    return { verified: false, email: null };
  }

  getVerificationDelegateOrThrow();
  const tokenHash = hashVerificationToken(token);

  const pending = await prisma.pendingUserRegistration.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      passwordHash: true,
      role: true,
      createdVia: true,
      createdIp: true,
      tokenExpiresAt: true,
      consumedAt: true,
      userId: true,
    },
  });

  if (!pending || pending.consumedAt || pending.tokenExpiresAt <= now) {
    return { verified: false, email: pending?.email ?? null };
  }

  const claim = await prisma.pendingUserRegistration.updateMany({
    where: {
      id: pending.id,
      consumedAt: null,
      tokenExpiresAt: { gt: now },
    },
    data: { consumedAt: now },
  });

  if (claim.count !== 1) {
    return { verified: false, email: pending.email };
  }

  const existingUser = await prisma.user.findFirst({
    where: {
      email: {
        equals: pending.email,
        mode: "insensitive",
      },
    },
    select: { id: true },
  });

  let userId = existingUser?.id ?? null;
  if (!userId) {
    const createdUser = await createUserFromTrustedFlow({
      firstName: pending.firstName,
      lastName: pending.lastName,
      email: pending.email,
      passwordHash: pending.passwordHash,
      role: Role.CLIENT,
      createdVia: pending.createdVia,
      createdIp: pending.createdIp,
      activationStatus: UserActivationStatus.ACTIVE,
      isActive: true,
      markEmailVerified: true,
    });
    userId = createdUser.id;
  } else {
    await syncEmailVerificationState({ userId, verifiedAt: now });
    await prisma.user.update({
      where: { id: userId },
      data: {
        activationStatus: UserActivationStatus.ACTIVE,
        isActive: true,
        isInactive: false,
      },
    });
  }

  await prisma.pendingUserRegistration.update({
    where: { id: pending.id },
    data: { userId },
  });

  console.info("[user-identity] registration_verified", { email: pending.email, userId });
  return { verified: true, email: pending.email };
}

export async function requestEmailChange(input: {
  userId: string;
  newEmail: string;
  currentPassword: string;
  appUrl?: string;
  now?: Date;
}): Promise<{ outcome: "SENT" | "SKIPPED" | "RATE_LIMITED" }> {
  const now = input.now ?? new Date();
  const newEmail = normalizeEmail(input.newEmail);
  if (!newEmail) {
    throw new UserIdentityError("INVALID_INPUT", "Email is required.");
  }

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: {
      id: true,
      email: true,
      name: true,
      passwordHash: true,
    },
  });

  if (!user) {
    return { outcome: "SKIPPED" };
  }

  if (!user.passwordHash) {
    throw new UserIdentityError("EMAIL_CHANGE_REQUIRES_PASSWORD", "Password-authenticated account required.");
  }

  const passwordOk = await verifyPassword(input.currentPassword, user.passwordHash);
  if (!passwordOk) {
    throw new UserIdentityError("INVALID_CURRENT_PASSWORD", "Current password is incorrect.");
  }

  if (user.email.toLowerCase() === newEmail) {
    return { outcome: "SKIPPED" };
  }

  if (isDisposableEmail(newEmail)) {
    throw new UserIdentityError("DISPOSABLE_EMAIL_BLOCKED", "Disposable email domains are not allowed.");
  }

  const existingEmailOwner = await prisma.user.findFirst({
    where: {
      email: {
        equals: newEmail,
        mode: "insensitive",
      },
      NOT: { id: user.id },
    },
    select: { id: true },
  });

  if (existingEmailOwner) {
    throw new UserIdentityError("EMAIL_ALREADY_IN_USE", "That email is already in use.");
  }

  const [rateLimitedByUser, rateLimitedByEmail] = await Promise.all([
    shouldRateLimit(`email-change:user:${user.id}`, now, EMAIL_CHANGE_RATE_LIMIT_WINDOW_MS),
    shouldRateLimit(`email-change:email:${newEmail}`, now, EMAIL_CHANGE_RATE_LIMIT_WINDOW_MS),
  ]);

  if (rateLimitedByUser || rateLimitedByEmail) {
    console.info("[user-identity] email_change_rate_limited", { userId: user.id, newEmail });
    return { outcome: "RATE_LIMITED" };
  }

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashVerificationToken(rawToken);
  const tokenExpiresAt = new Date(now.getTime() + VERIFICATION_TTL_MS);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      pendingEmail: newEmail,
      pendingEmailTokenHash: tokenHash,
      pendingEmailTokenExpiresAt: tokenExpiresAt,
    },
  });

  const appUrl = input.appUrl ?? process.env.APP_URL ?? "http://localhost:3000";
  const verificationUrl = `${appUrl.replace(/\/$/, "")}/verify-email?emailChangeToken=${encodeURIComponent(rawToken)}&email=${encodeURIComponent(newEmail)}`;

  await sendVerificationEmail({
    to: newEmail,
    verificationUrl,
    name: user.name,
    subject: "Confirm your new email",
  });

  console.info("[user-identity] email_change_requested", { userId: user.id, pendingEmail: newEmail });
  return { outcome: "SENT" };
}

export async function confirmEmailChangeByToken(input: {
  token: string;
  now?: Date;
}): Promise<{ verified: boolean; email: string | null }> {
  const now = input.now ?? new Date();
  const token = input.token.trim();
  if (!token) {
    return { verified: false, email: null };
  }

  const tokenHash = hashVerificationToken(token);
  const user = await prisma.user.findFirst({
    where: { pendingEmailTokenHash: tokenHash },
    select: {
      id: true,
      pendingEmail: true,
      pendingEmailTokenExpiresAt: true,
      email: true,
    },
  });

  if (!user || !user.pendingEmail || !user.pendingEmailTokenExpiresAt || user.pendingEmailTokenExpiresAt <= now) {
    return { verified: false, email: user?.pendingEmail ?? null };
  }

  const existingOwner = await prisma.user.findFirst({
    where: {
      email: {
        equals: user.pendingEmail,
        mode: "insensitive",
      },
      NOT: { id: user.id },
    },
    select: { id: true },
  });

  if (existingOwner) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        pendingEmail: null,
        pendingEmailTokenHash: null,
        pendingEmailTokenExpiresAt: null,
      },
    });
    return { verified: false, email: user.pendingEmail };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      email: user.pendingEmail,
      emailVerified: now,
      emailVerifiedAt: now,
      lastEmailChangeAt: now,
      pendingEmail: null,
      pendingEmailTokenHash: null,
      pendingEmailTokenExpiresAt: null,
    },
  });

  await prisma.verificationToken.deleteMany({ where: { identifier: user.email } });
  console.info("[user-identity] email_change_completed", { userId: user.id, email: user.pendingEmail });

  return { verified: true, email: user.pendingEmail };
}

export async function applyTrustedAdminEmailChange(input: {
  userId: string;
  newEmail: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const email = normalizeEmail(input.newEmail);
  if (!email) {
    throw new UserIdentityError("INVALID_INPUT", "Email is required.");
  }

  return prisma.user.update({
    where: { id: input.userId },
    data: {
      email,
      emailVerified: now,
      emailVerifiedAt: now,
      lastEmailChangeAt: now,
      pendingEmail: null,
      pendingEmailTokenHash: null,
      pendingEmailTokenExpiresAt: null,
    },
  });
}
