const E2E_SECRET_HEADER = "x-e2e-test-secret";
const E2E_PRODUCTION_RUNTIME_OVERRIDE = "E2E_ALLOW_PRODUCTION_RUNTIME";

export function isE2ETestModeRequested(): boolean {
  return process.env.E2E_TEST_MODE === "1";
}

export function isE2EProductionRuntimeAllowed(): boolean {
  return process.env[E2E_PRODUCTION_RUNTIME_OVERRIDE] === "1";
}

export function isE2ETestModeEnabled(): boolean {
  if (!isE2ETestModeRequested()) {
    return false;
  }

  return process.env.NODE_ENV !== "production" || isE2EProductionRuntimeAllowed();
}

export function assertE2ETestRequest(request: Request): Response | null {
  if (!isE2ETestModeEnabled()) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const expectedSecret = process.env.E2E_TEST_SECRET?.trim();
  if (!expectedSecret) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const providedSecret = request.headers.get(E2E_SECRET_HEADER)?.trim();
  if (!providedSecret || expectedSecret !== providedSecret) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  return null;
}
