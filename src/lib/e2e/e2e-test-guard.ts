const E2E_SECRET_HEADER = "x-e2e-test-secret";

export function isE2ETestModeEnabled(): boolean {
  return process.env.E2E_TEST_MODE === "1";
}

export function assertE2ETestRequest(request: Request): Response | null {
  if (!isE2ETestModeEnabled()) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const expectedSecret = process.env.E2E_TEST_SECRET?.trim();
  const providedSecret = request.headers.get(E2E_SECRET_HEADER)?.trim();
  if (!expectedSecret || !providedSecret || expectedSecret !== providedSecret) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  return null;
}
