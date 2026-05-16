import { ProductType, Role, StudioSessionStatus, UserActivationStatus } from "@prisma/client";
import { compare } from "bcryptjs";
import prisma from "../src/lib/db";
import {
  SEEDED_EMAIL_DOMAIN,
  SEEDED_USER_PASSWORD,
} from "../prisma/seed/seed-credentials";

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

async function main() {
  const clientEmail = normalizeEmail(
    process.env.UAT_E2E_CLIENT_EMAIL?.trim() ||
      process.env.UAT_E2E_EMAIL?.trim() ||
      `e2e-client@${SEEDED_EMAIL_DOMAIN}`,
  );
  const adminEmail = normalizeEmail(
    process.env.UAT_E2E_ADMIN_EMAIL?.trim() || `e2e-admin@${SEEDED_EMAIL_DOMAIN}`,
  );
  const clientPassword =
    process.env.UAT_E2E_CLIENT_PASSWORD?.trim() ||
    process.env.UAT_E2E_PASSWORD?.trim() ||
    SEEDED_USER_PASSWORD;
  const adminPassword = process.env.UAT_E2E_ADMIN_PASSWORD?.trim() || SEEDED_USER_PASSWORD;

  const client = await prisma.user.findUnique({
    where: { email: clientEmail },
    select: {
      role: true,
      isActive: true,
      isInactive: true,
      activationStatus: true,
      emailVerified: true,
      emailVerifiedAt: true,
      passwordHash: true,
    },
  });

  const admin = await prisma.user.findUnique({
    where: { email: adminEmail },
    select: {
      role: true,
      isActive: true,
      isInactive: true,
      activationStatus: true,
      emailVerified: true,
      emailVerifiedAt: true,
      passwordHash: true,
    },
  });

  if (!clientEmail.endsWith(`@${SEEDED_EMAIL_DOMAIN}`)) {
    throw new Error(`Client E2E email must end with @${SEEDED_EMAIL_DOMAIN}.`);
  }
  if (!adminEmail.endsWith(`@${SEEDED_EMAIL_DOMAIN}`)) {
    throw new Error(`Admin E2E email must end with @${SEEDED_EMAIL_DOMAIN}.`);
  }

  if (!client) throw new Error("Client E2E user missing.");
  if (client.role !== Role.CLIENT) throw new Error(`Client E2E user role mismatch: ${client.role}`);
  if (!client.isActive || client.isInactive || client.activationStatus !== UserActivationStatus.ACTIVE) {
    throw new Error("Client E2E user is not active.");
  }
  if (!client.emailVerified && !client.emailVerifiedAt) throw new Error("Client E2E user is not verified.");
  if (!client.passwordHash) throw new Error("Client E2E user is missing password hash.");
  if (!(await compare(clientPassword, client.passwordHash))) {
    throw new Error("Client E2E password hash mismatch for configured/default credential.");
  }

  if (!admin) throw new Error("Admin E2E user missing.");
  if (![Role.ADMIN, Role.MASTER_ADMIN].includes(admin.role)) {
    throw new Error(`Admin E2E user role mismatch: ${admin.role}`);
  }
  if (!admin.isActive || admin.isInactive || admin.activationStatus !== UserActivationStatus.ACTIVE) {
    throw new Error("Admin E2E user is not active.");
  }
  if (!admin.emailVerified && !admin.emailVerifiedAt) throw new Error("Admin E2E user is not verified.");
  if (!admin.passwordHash) throw new Error("Admin E2E user is missing password hash.");
  if (!(await compare(adminPassword, admin.passwordHash))) {
    throw new Error("Admin E2E password hash mismatch for configured/default credential.");
  }

  const [subscriptionOfferings, bookableSessions, storeProducts] = await prisma.$transaction([
    prisma.price.count({
      where: {
        isActive: true,
        isArchived: false,
        product: {
          isActive: true,
          isArchived: false,
          productType: { in: [ProductType.UNLIMITED_MEMBERSHIP, ProductType.CLASS_PACK, ProductType.DROP_IN_CLASS] },
        },
      },
    }),
    prisma.studioSession.count({
      where: { status: StudioSessionStatus.SCHEDULED, isPublished: true, startsAt: { gt: new Date() } },
    }),
    prisma.product.count({
      where: {
        isActive: true,
        isArchived: false,
        productType: { in: [ProductType.GIFT_CARD, ProductType.MERCHANDISE] },
      },
    }),
  ]);

  console.info("[staging-e2e-verify] summary");
  console.info("[staging-e2e-verify] client user present: yes");
  console.info("[staging-e2e-verify] client verified: yes");
  console.info("[staging-e2e-verify] client role: CLIENT");
  console.info(`[staging-e2e-verify] admin present: yes (${admin.role})`);
  console.info(`[staging-e2e-verify] subscription offerings present: ${subscriptionOfferings}`);
  console.info(`[staging-e2e-verify] bookable sessions present: ${bookableSessions}`);
  console.info(`[staging-e2e-verify] store products present: ${storeProducts}`);

  if (subscriptionOfferings === 0) throw new Error("No active subscription/catalog prices found.");
  if (bookableSessions === 0) throw new Error("No future bookable sessions found.");
  if (storeProducts === 0) throw new Error("No active store products found.");
}

main()
  .catch((error) => {
    console.error("[staging-e2e-verify] failed", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
