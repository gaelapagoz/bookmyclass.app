import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    studioSession: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: dbMock,
}));

import { getKioskSessionContext } from "../../src/lib/kiosk/kiosk-service";

describe("kiosk service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects private classes in kiosk session context", async () => {
    dbMock.studioSession.findUnique.mockResolvedValue({
      id: "session-private-1",
      title: "Private Session",
      startsAt: new Date(),
      endsAt: new Date(Date.now() + 60 * 60 * 1000),
      status: "SCHEDULED",
      classType: {
        name: "Private Pilates",
        category: {
          slug: "private-classes",
        },
      },
      bookings: [],
    });

    await expect(getKioskSessionContext("session-private-1")).rejects.toThrow(
      "PRIVATE_CLASSES_NOT_ELIGIBLE_FOR_KIOSK",
    );
  });
});

