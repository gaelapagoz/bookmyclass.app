import "dotenv/config";
import { compare } from "bcryptjs";
import { UserActivationStatus } from "@prisma/client";
import prisma from "../src/lib/db";
import { SEEDED_EMAIL_DOMAIN, SEEDED_USER_PASSWORD } from "../prisma/seed/seed-credentials";

const REQUIRED_COHORTS = ["entitlement_collective", "no_entitlement", "subscription_buyer"] as const;
const REQUIRED_PER_COHORT = 400;

type CohortName = (typeof REQUIRED_COHORTS)[number];

function parseCohort(email: string): CohortName | null {
  const normalized = email.trim().toLowerCase();
  const match = normalized.match(/^k6-uat-(entitlement_collective|no_entitlement|subscription_buyer)-\d{4}@/);
  if (!match) {
    return null;
  }
  return match[1] as CohortName;
}

async function main() {
  const users = await prisma.user.findMany({
    where: {
      email: { startsWith: "k6-uat-" },
    },
    select: {
      id: true,
      email: true,
      passwordHash: true,
      isActive: true,
      isInactive: true,
      activationStatus: true,
      emailVerified: true,
      emailVerifiedAt: true,
    },
  });

  const cohortCounts: Record<CohortName, number> = {
    entitlement_collective: 0,
    no_entitlement: 0,
    subscription_buyer: 0,
  };

  const uniquePasswordHashes = new Set<string>();
  for (const user of users) {
    const email = String(user.email || "").trim().toLowerCase();
    if (email.includes(".local") || !email.endsWith(`@${SEEDED_EMAIL_DOMAIN}`)) {
      throw new Error(`Invalid k6 seeded email domain: ${email}`);
    }

    const cohort = parseCohort(email);
    if (!cohort) {
      throw new Error(`Invalid k6 seeded cohort email pattern: ${email}`);
    }

    if (!user.isActive || user.isInactive || user.activationStatus !== UserActivationStatus.ACTIVE) {
      throw new Error(`k6 user is not active/login-capable: ${email}`);
    }

    if (!user.emailVerified && !user.emailVerifiedAt) {
      throw new Error(`k6 user is not verified: ${email}`);
    }

    uniquePasswordHashes.add(user.passwordHash);

    cohortCounts[cohort] += 1;
  }

  for (const hash of uniquePasswordHashes) {
    const passwordMatches = await compare(SEEDED_USER_PASSWORD, hash);
    if (!passwordMatches) {
      throw new Error("k6 user password policy mismatch detected for one or more seeded users.");
    }
  }

  for (const cohort of REQUIRED_COHORTS) {
    if (cohortCounts[cohort] < REQUIRED_PER_COHORT) {
      throw new Error(
        `Missing required cohort population: ${cohort} expected>=${REQUIRED_PER_COHORT} actual=${cohortCounts[cohort]}`,
      );
    }
  }

  const entitlementUsers = await prisma.user.findMany({
    where: {
      email: { startsWith: "k6-uat-entitlement_collective-" },
    },
    select: {
      id: true,
      email: true,
      clientEntitlements: {
        where: {
          entitlementScope: "COLLECTIVE_CLASSES",
          status: "ACTIVE",
        },
        select: {
          id: true,
        },
      },
    },
    take: REQUIRED_PER_COHORT,
  });

  for (const user of entitlementUsers) {
    if (!user.clientEntitlements.length) {
      throw new Error(`entitlement_collective user missing active collective entitlement: ${user.email}`);
    }
  }

  console.info("[db:verify:uat:k6] OK");
  console.info(
    `[db:verify:uat:k6] users=${users.length} cohorts entitlement_collective=${cohortCounts.entitlement_collective} no_entitlement=${cohortCounts.no_entitlement} subscription_buyer=${cohortCounts.subscription_buyer}`,
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error("[db:verify:uat:k6] FAILED", error instanceof Error ? error.message : String(error));
    await prisma.$disconnect();
    process.exit(1);
  });
