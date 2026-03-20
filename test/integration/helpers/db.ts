import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import "./setup-env";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set in .env.test.");
}

const pool = new Pool({ connectionString: databaseUrl });

export const prisma = new PrismaClient({
  adapter: new PrismaPg(pool),
});
