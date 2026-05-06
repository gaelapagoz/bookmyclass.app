import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    studioSession: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    siteSettings: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: dbMock,
}));

import { getKioskSessionContext, getKioskTodaySelectableSessions } from "../../src/lib/kiosk/kiosk-service";

describe("kiosk service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.siteSettings.findUnique.mockResolvedValue({ timeZone: "Europe/Brussels" });
  });

  it("uses configured timezone for kiosk today boundaries and labels", async () => {
    dbMock.siteSettings.findUnique.mockResolvedValue({ timeZone: "America/New_York" });
    dbMock.studioSession.findMany.mockResolvedValue([
      {
        id: "session-1",
        title: "Late Flow",
        startsAt: new Date("2026-04-16T01:30:00.000Z"),
        endsAt: new Date("2026-04-16T02:30:00.000Z"),
        capacity: 10,
        classType: {
          name: "Collective Flow",
          category: { slug: "collective" },
        },
        bookings: [],
      },
    ]);

    const sessions = await getKioskTodaySelectableSessions(new Date("2026-04-15T23:30:00.000Z"));

    expect(dbMock.studioSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          startsAt: {
            gte: new Date("2026-04-15T04:00:00.000Z"),
            lt: new Date("2026-04-16T04:00:00.000Z"),
          },
        }),
      }),
    );
    expect(sessions[0]?.timeLabel).toBe("21:30");
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
