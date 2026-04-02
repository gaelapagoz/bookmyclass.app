import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set.");
}

const adapter = new PrismaPg({ connectionString: databaseUrl });

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
      runtimeClient.marketingUnsubscribe,
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
