/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceBookingExperience } from "../../src/components/book-a-class/service-detail/ServiceBookingExperience";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ServiceBookingExperience", () => {
  it("selecting a day updates slots and empty day shows no availability", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);

      if (url.includes("/slots?date=2026-04-11")) {
        return {
          ok: true,
          json: async () => ({
            date: "2026-04-11",
            timezone: "Europe/Brussels",
            slots: [],
          }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({
          date: "2026-04-10",
          timezone: "Europe/Brussels",
          slots: [
            {
              id: "slot-1",
              date: "2026-04-10",
              startTime: "18:00",
              endTime: "19:00",
              capacity: 12,
              availableSpots: 4,
              isAvailable: true,
            },
          ],
        }),
      } as Response;
    });

    render(
      <ServiceBookingExperience
        isAuthenticated={true}
        service={{
          id: "service-1",
          slug: "vinyasa-yoga",
          title: "Vinyasa Yoga",
          shortDescription: "Flow class",
          description: "Full description",
          imageUrl: null,
          durationMinutes: 60,
        }}
        initialMonthKey="2026-04"
        initialAvailabilityDays={[
          { date: "2026-04-10", totalSlots: 1, availableSlots: 1, hasAvailability: true },
          { date: "2026-04-11", totalSlots: 0, availableSlots: 0, hasAvailability: false },
        ]}
        initialSelectedDate="2026-04-10"
        initialSlots={[
          {
            id: "slot-1",
            date: "2026-04-10",
            startTime: "18:00",
            endTime: "19:00",
            capacity: 12,
            availableSpots: 4,
            isAvailable: true,
          },
        ]}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Select 2026-04-11" }));

    await waitFor(() => {
      expect(screen.getByText("No availability on this date.")).toBeInTheDocument();
    });

    expect(fetchSpy).toHaveBeenCalledWith("/api/services/vinyasa-yoga/slots?date=2026-04-11");
  });

  it("check next availability updates selected day and slot list", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);

      if (url.includes("/next-availability")) {
        return {
          ok: true,
          json: async () => ({
            timezone: "Europe/Brussels",
            next: {
              id: "slot-2",
              date: "2026-04-12",
              month: "2026-04",
              startTime: "09:00",
              endTime: "10:00",
              capacity: 10,
              availableSpots: 3,
              isAvailable: true,
            },
          }),
        } as Response;
      }

      if (url.includes("/slots?date=2026-04-12")) {
        return {
          ok: true,
          json: async () => ({
            date: "2026-04-12",
            timezone: "Europe/Brussels",
            slots: [
              {
                id: "slot-2",
                date: "2026-04-12",
                startTime: "09:00",
                endTime: "10:00",
                capacity: 10,
                availableSpots: 3,
                isAvailable: true,
              },
            ],
          }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({ month: "2026-04", timezone: "Europe/Brussels", days: [] }),
      } as Response;
    });

    render(
      <ServiceBookingExperience
        isAuthenticated={true}
        service={{
          id: "service-1",
          slug: "vinyasa-yoga",
          title: "Vinyasa Yoga",
          shortDescription: "Flow class",
          description: "Full description",
          imageUrl: null,
          durationMinutes: 60,
        }}
        initialMonthKey="2026-04"
        initialAvailabilityDays={[]}
        initialSelectedDate={null}
        initialSlots={[]}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Check next available date" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Availability for 2026-04-12" })).toBeInTheDocument();
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/api/services/vinyasa-yoga/next-availability?from="),
    );
    expect(fetchSpy).toHaveBeenCalledWith("/api/services/vinyasa-yoga/slots?date=2026-04-12");
  });
});
