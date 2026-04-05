export const E2E_PASSWORD = "E2EPass123!";

export const SEEDED_ADMIN = {
  email: "admin.e2e@bookmyclass.local",
  password: E2E_PASSWORD,
};

export const SEEDED_CLIENT_WITH_CREDITS = {
  email: "client.e2e@bookmyclass.local",
  password: E2E_PASSWORD,
};

export const SEEDED_CLIENT_NO_CREDITS = {
  email: "client.nocredits.e2e@bookmyclass.local",
  password: E2E_PASSWORD,
};

export const SEEDED_SERVICE_SLUG = "e2e-flow-class";

export const E2E_TEST_SECRET = process.env.E2E_TEST_SECRET ?? "";
