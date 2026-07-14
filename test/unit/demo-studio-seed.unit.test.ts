import { describe, expect, it } from "vitest";

import {
  DEMO_CLASS_CATALOGUE,
  DEMO_CLIENTS,
  DEMO_CLIENT_COUNT,
  DEMO_PRODUCTS,
  DEMO_SHARED_VIDEO_URL,
  DEMO_STUDIO,
  DEMO_WEEKLY_SCHEDULE,
  assertDemoScheduleAgreement,
} from "../../prisma/seed/data/demo-studio";

describe("demo Studio Aster seed contract", () => {
  it("uses the requested studio identity and fixed synthetic clients", () => {
    expect(DEMO_STUDIO).toMatchObject({
      name: "Studio Aster",
      descriptor: "Yoga, Pilates & Functional Training",
      contactEmail: "hello@bookmyclass.app",
    });
    expect(DEMO_CLIENTS).toHaveLength(DEMO_CLIENT_COUNT);
    expect(DEMO_CLIENTS.map(([localPart]) => `${localPart}@bookmyclass.app`)).toContain("emma.desmet@bookmyclass.app");
    expect(DEMO_CLIENTS.some(([, firstName]) => firstName === "Test")).toBe(false);
  });

  it("keeps the public agenda and bookable demo classes in agreement", () => {
    expect(() => assertDemoScheduleAgreement()).not.toThrow();
    expect(DEMO_WEEKLY_SCHEDULE).toEqual([
      expect.objectContaining({ dayOfWeek: "MONDAY", startTime: "18:00", endTime: "18:45", label: "Functional Training" }),
      expect.objectContaining({ dayOfWeek: "MONDAY", startTime: "19:00", endTime: "20:00", label: "Vinyasa Yoga" }),
      expect.objectContaining({ dayOfWeek: "TUESDAY", startTime: "18:00", endTime: "18:55", label: "Mat Pilates" }),
      expect.objectContaining({ dayOfWeek: "TUESDAY", startTime: "19:15", endTime: "20:15", label: "Vinyasa Yoga" }),
      expect.objectContaining({ dayOfWeek: "WEDNESDAY", startTime: "18:30", endTime: "19:30", label: "Pilates & Stretching" }),
      expect.objectContaining({ dayOfWeek: "THURSDAY", startTime: "18:00", endTime: "18:55", label: "Mat Pilates" }),
      expect.objectContaining({ dayOfWeek: "THURSDAY", startTime: "19:15", endTime: "20:15", label: "Pilates & Stretching" }),
      expect.objectContaining({ dayOfWeek: "SATURDAY", startTime: "09:30", endTime: "10:30", label: "Rocket Yoga" }),
      expect.objectContaining({ dayOfWeek: "SATURDAY", startTime: "11:00", endTime: "12:00", label: "Vinyasa Yoga" }),
    ]);
  });

  it("matches requested class and product terminology", () => {
    expect(DEMO_CLASS_CATALOGUE.map((entry) => [entry.name, entry.durationMinutes, entry.capacity])).toEqual([
      ["Vinyasa Yoga", 60, 10],
      ["Rocket Yoga", 60, 10],
      ["Mat Pilates", 55, 10],
      ["Pilates & Stretching", 60, 10],
      ["Functional Training", 45, 8],
      ["Private Reformer", 50, 1],
    ]);
    expect(DEMO_PRODUCTS.map((product) => product.name)).toEqual([
      "Drop-in Class",
      "5-Class Pack",
      "10-Class Pack",
      "Unlimited Monthly Membership",
      "5 Private Sessions",
      "10 Private Sessions",
    ]);
    expect(DEMO_PRODUCTS.map((product) => product.validForDays)).toEqual([30, 90, 180, undefined, 180, 240]);
  });

  it("uses one shared demo video URL for learning fixtures", () => {
    expect(DEMO_SHARED_VIDEO_URL).toContain("player.vimeo.com");
  });
});
