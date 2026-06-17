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

import { requireAdminSession, requireTeacherSession, requireVerifiedUser } from "@/lib/auth/require-auth";

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

describe("requireTeacherSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws UNAUTHENTICATED when session is missing", async () => {
    authMock.mockResolvedValue(null);

    await expect(requireTeacherSession({ throwOnFailure: true })).rejects.toThrow("NEXT_REDIRECT");
  });

  it("throws UNAUTHENTICATED when DB re-check cannot find user", async () => {
    authMock.mockResolvedValue({ user: { id: "teacher-1", role: "TEACHER" } });
    findUniqueMock.mockResolvedValue(null);

    await expect(requireTeacherSession({ throwOnFailure: true })).rejects.toThrow("UNAUTHENTICATED");
  });

  it("throws UNAUTHENTICATED when DB user is deactivated (JWT still valid)", async () => {
    authMock.mockResolvedValue({ user: { id: "teacher-1", role: "TEACHER" } });
    findUniqueMock.mockResolvedValue({
      role: "TEACHER",
      activationStatus: "DISABLED",
      isActive: false,
    });

    await expect(requireTeacherSession({ throwOnFailure: true })).rejects.toThrow("UNAUTHENTICATED");
  });

  it("throws UNAUTHENTICATED when DB user isActive is false", async () => {
    authMock.mockResolvedValue({ user: { id: "teacher-1", role: "TEACHER" } });
    findUniqueMock.mockResolvedValue({
      role: "TEACHER",
      activationStatus: "ACTIVE",
      isActive: false,
    });

    await expect(requireTeacherSession({ throwOnFailure: true })).rejects.toThrow("UNAUTHENTICATED");
  });

  it("throws FORBIDDEN when DB role is not TEACHER (JWT role was spoofed)", async () => {
    authMock.mockResolvedValue({ user: { id: "client-1", role: "TEACHER" } });
    findUniqueMock.mockResolvedValue({
      role: "CLIENT",
      activationStatus: "ACTIVE",
      isActive: true,
    });

    await expect(requireTeacherSession({ throwOnFailure: true })).rejects.toThrow("FORBIDDEN");
  });

  it("returns session with TEACHER role on success", async () => {
    authMock.mockResolvedValue({
      user: { id: "teacher-1", role: "TEACHER", email: "teacher@example.test" },
      expires: "2099-01-01T00:00:00.000Z",
    });
    findUniqueMock.mockResolvedValue({
      role: "TEACHER",
      activationStatus: "ACTIVE",
      isActive: true,
    });

    const session = await requireTeacherSession({ throwOnFailure: true });

    expect(session.user.role).toBe("TEACHER");
    expect(session.user.id).toBe("teacher-1");
  });
});

describe("requireVerifiedUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to stale-session when the DB user is inactive even if the JWT is present", async () => {
    authMock.mockResolvedValue({
      user: { id: "client-1", role: "CLIENT", email: "client@example.test" },
      expires: "2099-01-01T00:00:00.000Z",
    });
    findUniqueMock.mockResolvedValue({
      role: "CLIENT",
      email: "client@example.test",
      emailVerified: new Date("2099-01-01T00:00:00.000Z"),
      activationStatus: "ACTIVE",
      isActive: false,
    });

    await expect(requireVerifiedUser()).rejects.toThrow(
      "NEXT_REDIRECT:/auth/stale-session?callbackUrl=%2Fdashboard",
    );
  });

  it("redirects to stale-session when the DB lookup throws", async () => {
    authMock.mockResolvedValue({
      user: { id: "client-1", role: "CLIENT", email: "client@example.test" },
      expires: "2099-01-01T00:00:00.000Z",
    });
    findUniqueMock.mockRejectedValue(new Error("db unavailable"));

    await expect(requireVerifiedUser()).rejects.toThrow(
      "NEXT_REDIRECT:/auth/stale-session?callbackUrl=%2Fdashboard",
    );
  });

  it("returns the session with the DB-validated role on success", async () => {
    authMock.mockResolvedValue({
      user: { id: "admin-1", role: "CLIENT", email: "admin@example.test" },
      expires: "2099-01-01T00:00:00.000Z",
    });
    findUniqueMock.mockResolvedValue({
      role: "ADMIN",
      email: "admin@example.test",
      emailVerified: null,
      activationStatus: "ACTIVE",
      isActive: true,
    });

    const session = await requireVerifiedUser();

    expect(session.user.role).toBe("ADMIN");
  });
});
