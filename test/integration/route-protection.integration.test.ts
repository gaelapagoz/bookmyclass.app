import "./helpers/setup-env";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

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
  beforeEach(async () => {
    await resetDb();
    redirectMock.mockClear();
    vi.mocked(auth).mockReset();
  });

  it("unauthenticated user cannot access /dashboard", async () => {
    vi.mocked(auth).mockResolvedValue(null);

    await expect(requireAuth()).rejects.toThrow("NEXT_REDIRECT:/sign-in?callbackUrl=%2Fdashboard");
    expect(redirectMock).toHaveBeenCalledWith("/sign-in?callbackUrl=%2Fdashboard");
  });

  it("unverified authenticated user cannot access /dashboard", async () => {
    const user = await prisma.user.create({
      data: {
        name: "Unverified Client",
        firstName: "Unverified",
        lastName: "Client",
        email: `unverified.route.${Date.now()}@example.test`,
        emailVerified: null,
      },
    });

    vi.mocked(auth).mockResolvedValue({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    await expect(requireAuth()).rejects.toThrow(
      `NEXT_REDIRECT:/verify-email?blocked=1&email=${encodeURIComponent(user.email)}`,
    );
  });

  it("stale session user (deleted/reset) is redirected to stale-session cleanup route", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: {
        id: "stale-user-id",
        name: "Stale",
        email: "stale@example.test",
      },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    await expect(requireAuth()).rejects.toThrow(
      "NEXT_REDIRECT:/auth/stale-session?callbackUrl=%2Fdashboard",
    );
  });

  it("verified authenticated user can access /dashboard", async () => {
    const user = await prisma.user.create({
      data: {
        name: "Verified Client",
        firstName: "Verified",
        lastName: "Client",
        email: `verified.route.${Date.now()}@example.test`,
        emailVerified: new Date(),
      },
    });

    vi.mocked(auth).mockResolvedValue({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const session = await requireAuth();

    expect(session.user?.email).toBe(user.email);
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
