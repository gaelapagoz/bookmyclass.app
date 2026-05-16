import { ProductType, Role, StudioSessionStatus, UserActivationStatus } from "@prisma/client";
import prisma from "../src/lib/db";

function requiredEnv(names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  throw new Error(`Missing required env var. One of: ${names.join(", ")}`);
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

async function main() {
  const clientEmail = normalizeEmail(requiredEnv(["UAT_E2E_CLIENT_EMAIL", "UAT_E2E_EMAIL"]));
  const adminEmail = normalizeEmail(requiredEnv(["UAT_E2E_ADMIN_EMAIL"]));

  const client = await prisma.user.findUnique({
    where: { email: clientEmail },
    select: {
      role: true,
      isActive: true,
      isInactive: true,
      activationStatus: true,
      emailVerified: true,
      emailVerifiedAt: true,
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
    },
  });

  if (!client) throw new Error("Client E2E user missing.");
  if (client.role !== Role.CLIENT) throw new Error(`Client E2E user role mismatch: ${client.role}`);
  if (!client.isActive || client.isInactive || client.activationStatus !== UserActivationStatus.ACTIVE) {
    throw new Error("Client E2E user is not active.");
  }
  if (!client.emailVerified && !client.emailVerifiedAt) throw new Error("Client E2E user is not verified.");

  if (!admin) throw new Error("Admin E2E user missing.");
  if (![Role.ADMIN, Role.MASTER_ADMIN].includes(admin.role)) {
    throw new Error(`Admin E2E user role mismatch: ${admin.role}`);
  }
  if (!admin.isActive || admin.isInactive || admin.activationStatus !== UserActivationStatus.ACTIVE) {
    throw new Error("Admin E2E user is not active.");
  }
  if (!admin.emailVerified && !admin.emailVerifiedAt) throw new Error("Admin E2E user is not verified.");

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
