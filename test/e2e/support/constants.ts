import { SEEDED_CANONICAL_EMAILS, SEEDED_USER_PASSWORD } from "../../../prisma/seed/seed-credentials";

export const E2E_PASSWORD = SEEDED_USER_PASSWORD;

export const SEEDED_ADMIN = {
  email: SEEDED_CANONICAL_EMAILS.e2eAdmin,
  password: E2E_PASSWORD,
};

export const SEEDED_CLIENT_WITH_CREDITS = {
  email: SEEDED_CANONICAL_EMAILS.e2eClient,
  password: E2E_PASSWORD,
};

export const SEEDED_TEACHER = {
  email: SEEDED_CANONICAL_EMAILS.teacher,
  password: E2E_PASSWORD,
};

export const SEEDED_CLIENT_NO_CREDITS = {
  email: "e2e-client-nocredits@bookmyclass.app",
  password: E2E_PASSWORD,
};

export const SEEDED_CLIENT_SMOKE = {
  email: "e2e-client-smoke@bookmyclass.app",
  password: E2E_PASSWORD,
};

export const SEEDED_SERVICE_SLUG = "e2e-flow-class";

export const E2E_TEST_SECRET = process.env.E2E_TEST_SECRET ?? "";
