import { describe, expect, it, vi } from "vitest";

const { findFirstMock } = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findFirst: findFirstMock,
    },
  },
}));

import { getSignInEligibilityUserByEmail } from "@/lib/auth/sign-in-service";

describe("getSignInEligibilityUserByEmail", () => {
  it("uses case-insensitive email lookup with expected select shape", async () => {
    findFirstMock.mockResolvedValueOnce(null);

    await getSignInEligibilityUserByEmail("User@Example.com");

    expect(findFirstMock).toHaveBeenCalledWith({
      where: {
        email: {
          equals: "User@Example.com",
          mode: "insensitive",
        },
      },
      select: {
        role: true,
        emailVerified: true,
        activationStatus: true,
      },
    });
  });
});
