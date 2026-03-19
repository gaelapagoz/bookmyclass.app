import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Role } from "@prisma/client";
import { hash } from "bcryptjs";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set.");
}

const pool = new Pool({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function seedUser(
  email: string,
  name: string,
  role: Role,
  password: string,
) {
  const passwordHash = await hash(password, 12);

  return prisma.user.upsert({
    where: { email },
    update: { name, role, passwordHash },
    create: { email, name, role, passwordHash },
  });
}

async function main() {
  await seedUser(
    "admin@onthematstudio.local",
    "Admin User",
    Role.ADMIN,
    "Admin123!",
  );
  await seedUser(
    "teacher@onthematstudio.local",
    "Teacher User",
    Role.TEACHER,
    "Teacher123!",
  );
  await seedUser(
    "client@onthematstudio.local",
    "Client User",
    Role.CLIENT,
    "Client123!",
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
    await pool.end();
  })
  .catch(async (error) => {
    console.error("Seed failed", error);
    await prisma.$disconnect();
    await pool.end();
    process.exit(1);
  });
