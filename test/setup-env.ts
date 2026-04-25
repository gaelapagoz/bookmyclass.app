import * as dotenv from "dotenv";
import { vi } from "vitest";

dotenv.config({ path: ".env.test", override: true });

process.env.NODE_ENV ??= "test";
process.env.DATABASE_URL ??= "postgresql://studiosaas:studiosaas@localhost:5432/studio_test?schema=public";
process.env.AUTH_SECRET ??= "test-auth-secret";
process.env.ADMIN_LOGIN_ABUSE_HASH_SECRET ??= process.env.AUTH_SECRET;

// Most integration tests should not exercise the real NextAuth runtime.
// Provide a stable, mockable auth boundary by default.
vi.mock("@/auth", () => ({
  handlers: {
    GET: vi.fn(async () => new Response("stub")),
    POST: vi.fn(async () => new Response("stub")),
  },
  auth: vi.fn(async () => null),
  signIn: vi.fn(async () => undefined),
  signOut: vi.fn(async () => undefined),
}));
