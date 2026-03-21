import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    const error = new Error(`NEXT_REDIRECT:${url}`);
    (error as Error & { digest?: string }).digest = `NEXT_REDIRECT;replace;${url};307;`;
    throw error;
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => null),
}));

import { auth } from "@/auth";
import { requireAuth } from "../../src/lib/auth/require-auth";

describe("route protection", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    vi.mocked(auth).mockReset();
  });

  it("unauthenticated user cannot access /dashboard", async () => {
    vi.mocked(auth).mockResolvedValue(null);

    await expect(requireAuth()).rejects.toThrow("NEXT_REDIRECT:/sign-in?callbackUrl=%2Fdashboard");
    expect(redirectMock).toHaveBeenCalledWith("/sign-in?callbackUrl=%2Fdashboard");
  });

  it("authenticated user can access /dashboard", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: {
        id: "user-1",
        name: "Client",
        email: "client@example.test",
      },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const session = await requireAuth();

    expect(session.user?.email).toBe("client@example.test");
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
