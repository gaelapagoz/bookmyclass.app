import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaPool?: Pool;
};

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set.");
}

const prismaPool =
  globalForPrisma.prismaPool ?? new Pool({ connectionString: databaseUrl });
const adapter = new PrismaPg(prismaPool);
const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

export { prisma };
export default prisma;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaPool = prismaPool;
  globalForPrisma.prisma = prisma;
}
