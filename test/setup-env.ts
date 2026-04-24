import { config } from "dotenv";

config({ path: ".env.test" });

process.env.NODE_ENV ??= "test";
process.env.DATABASE_URL ??= "postgresql://studiosaas:studiosaas@localhost:5432/studio_test?schema=public";
process.env.AUTH_SECRET ??= "test-auth-secret";
process.env.ADMIN_LOGIN_ABUSE_HASH_SECRET ??= process.env.AUTH_SECRET;
