import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirectMock, authMock, findUniqueMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    const error = new Error(`NEXT_REDIRECT:${url}`);
    (error as Error & { digest?: string }).digest = `NEXT_REDIRECT;replace;${url};307;`;
    throw error;
  }),
  authMock: vi.fn(),
  findUniqueMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

vi.mock("@/auth", () => ({
  auth: authMock,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: findUniqueMock,
    },
  },
}));

import { requireAdminSession } from "@/lib/auth/require-auth";

describe("requireAdminSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws UNAUTHENTICATED when session is missing and throwOnFailure is true", async () => {
    authMock.mockResolvedValue(null);

    await expect(requireAdminSession({ throwOnFailure: true })).rejects.toThrow("UNAUTHENTICATED");
  });

  it("throws UNAUTHENTICATED when DB re-check cannot find user", async () => {
    authMock.mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN" },
    });
    findUniqueMock.mockResolvedValue(null);

    await expect(requireAdminSession({ throwOnFailure: true })).rejects.toThrow("UNAUTHENTICATED");
  });

  it("throws UNAUTHENTICATED when DB re-check finds inactive/disabled admin", async () => {
    authMock.mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN" },
    });
    findUniqueMock.mockResolvedValue({
      role: "ADMIN",
      activationStatus: "DISABLED",
      isActive: false,
    });

    await expect(requireAdminSession({ throwOnFailure: true })).rejects.toThrow("UNAUTHENTICATED");
  });

  it("throws FORBIDDEN when DB role is not admin", async () => {
    authMock.mockResolvedValue({
      user: { id: "client-1", role: "ADMIN" },
    });
    findUniqueMock.mockResolvedValue({
      role: "CLIENT",
      activationStatus: "ACTIVE",
      isActive: true,
    });

    await expect(requireAdminSession({ throwOnFailure: true })).rejects.toThrow("FORBIDDEN");
  });

  it("returns session with DB-validated role on success", async () => {
    authMock.mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN", email: "admin@example.test" },
      expires: "2099-01-01T00:00:00.000Z",
    });
    findUniqueMock.mockResolvedValue({
      role: "MASTER_ADMIN",
      activationStatus: "ACTIVE",
      isActive: true,
    });

    const session = await requireAdminSession({ throwOnFailure: true });

    expect(session.user.role).toBe("MASTER_ADMIN");
  });
});
