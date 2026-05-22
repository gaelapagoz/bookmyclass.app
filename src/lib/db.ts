import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set.");
}

const isE2ETestMode = process.env.E2E_TEST_MODE === "1";

const adapter = new PrismaPg({
  connectionString: databaseUrl,
  ...(isE2ETestMode
    ? {
        max: 4,
        idleTimeoutMillis: 10_000,
      }
    : {}),
});

function hasRequiredDelegates(client: PrismaClient): boolean {
  const runtimeClient = client as unknown as {
    passwordResetToken?: unknown;
    passwordResetRateLimit?: unknown;
    pendingUserRegistration?: unknown;
    publicAuthRateLimit?: unknown;
    adminLoginAbuseCounter?: unknown;
    marketingCampaign?: unknown;
    marketingCampaignRecipient?: unknown;
    marketingCampaignLink?: unknown;
    marketingCampaignLinkClick?: unknown;
    marketingCategory?: unknown;
    marketingUnsubscribe?: unknown;
    giftCardWallet?: unknown;
    giftCardLedgerEntry?: unknown;
    giftCardRedemption?: unknown;
    giftCardReconciliationCase?: unknown;
  };
  return Boolean(
      runtimeClient.passwordResetToken &&
      runtimeClient.passwordResetRateLimit &&
      runtimeClient.pendingUserRegistration &&
      runtimeClient.publicAuthRateLimit &&
      runtimeClient.adminLoginAbuseCounter &&
      runtimeClient.marketingCampaign &&
      runtimeClient.marketingCampaignRecipient &&
      runtimeClient.marketingCampaignLink &&
      runtimeClient.marketingCampaignLinkClick &&
      runtimeClient.marketingCategory &&
      runtimeClient.marketingUnsubscribe &&
      runtimeClient.giftCardWallet &&
      runtimeClient.giftCardLedgerEntry &&
      runtimeClient.giftCardRedemption &&
      runtimeClient.giftCardReconciliationCase,
  );
}

function createPrismaClient(): PrismaClient {
  return new PrismaClient({ adapter });
}

const prisma =
  globalForPrisma.prisma && hasRequiredDelegates(globalForPrisma.prisma)
    ? globalForPrisma.prisma
    : createPrismaClient();

export { prisma };
export default prisma;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
