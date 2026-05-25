/**
 * Production seed mode - minimal bootstrap-only contract.
 * Creates exactly one deterministic MASTER_ADMIN account.
 * No demo/catalog/media/scheduling data is seeded in production mode.
 */

import { Role } from "@prisma/client";
import { hash } from "bcryptjs";
import prisma from "../../../src/lib/db";
import { SEEDED_CANONICAL_EMAILS, SEEDED_USER_PASSWORD } from "../seed-credentials";

const MASTER_ADMIN_EMAIL = SEEDED_CANONICAL_EMAILS.masterAdmin;
const MASTER_ADMIN_FIRST_NAME = "Master";
const MASTER_ADMIN_LAST_NAME = "Admin";
const MASTER_ADMIN_LAST_LOGIN_AT = new Date("2026-04-01T08:00:00.000Z");
const MASTER_ADMIN_EMAIL_VERIFIED_AT = new Date("2026-04-01T00:00:00.000Z");

async function upsertBootstrapMasterAdmin(): Promise<void> {
  const passwordHash = await hash(SEEDED_USER_PASSWORD, 12);
  const name = `${MASTER_ADMIN_FIRST_NAME} ${MASTER_ADMIN_LAST_NAME}`;

  await prisma.user.upsert({
    where: { email: MASTER_ADMIN_EMAIL },
    update: {
      name,
      firstName: MASTER_ADMIN_FIRST_NAME,
      lastName: MASTER_ADMIN_LAST_NAME,
      role: Role.MASTER_ADMIN,
      passwordHash,
      emailVerified: MASTER_ADMIN_EMAIL_VERIFIED_AT,
      emailVerifiedAt: MASTER_ADMIN_EMAIL_VERIFIED_AT,
      isActive: true,
      isInactive: false,
      lastLoginAt: MASTER_ADMIN_LAST_LOGIN_AT,
    },
    create: {
      email: MASTER_ADMIN_EMAIL,
      name,
      firstName: MASTER_ADMIN_FIRST_NAME,
      lastName: MASTER_ADMIN_LAST_NAME,
      role: Role.MASTER_ADMIN,
      passwordHash,
      emailVerified: MASTER_ADMIN_EMAIL_VERIFIED_AT,
      emailVerifiedAt: MASTER_ADMIN_EMAIL_VERIFIED_AT,
      isActive: true,
      isInactive: false,
      lastLoginAt: MASTER_ADMIN_LAST_LOGIN_AT,
    },
  });
}

async function verifyMinimalProductionSeed(): Promise<void> {
  const [masterAdminCount, adminCount, teacherCount, clientCount] = await prisma.$transaction([
    prisma.user.count({
      where: { role: Role.MASTER_ADMIN, email: { endsWith: "@bookmyclass.app" } },
    }),
    prisma.user.count({ where: { role: Role.ADMIN } }),
    prisma.user.count({ where: { role: Role.TEACHER } }),
    prisma.user.count({ where: { role: Role.CLIENT } }),
  ]);

  if (masterAdminCount !== 1) {
    throw new Error(
      `Production seed verification failed: expected exactly one bootstrap MASTER_ADMIN, got ${masterAdminCount}.`,
    );
  }
  if (adminCount > 0 || teacherCount > 0 || clientCount > 0) {
    throw new Error(
      `Production seed verification failed: expected minimal dataset only (admins=${adminCount}, teachers=${teacherCount}, clients=${clientCount}).`,
    );
  }
}

export async function runProductionSeed(): Promise<void> {
  console.info("[seed:prod] Starting production seed (mode: production - minimal bootstrap-only).");
  await upsertBootstrapMasterAdmin();
  await verifyMinimalProductionSeed();
  console.info("[seed:prod] Completed minimal production seed: bootstrap MASTER_ADMIN ready.");
}
