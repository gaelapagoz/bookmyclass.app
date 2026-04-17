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
  it("renders a single description block for selected class", () => {
    render(
      <ServiceBookingExperience
        isAuthenticated={true}
        service={{
          id: "service-1",
          slug: "vinyasa-yoga",
          title: "Vinyasa Yoga",
          shortDescription: "Duplicate description",
          description: "Duplicate description",
          imageUrl: null,
          classSummary: {
            title: "Class Summary",
            duration: "60 minutes",
            teacher: "Coach Marie",
            location: "Studio Brussels",
          },
        }}
        initialMonthKey="2026-04"
        initialAvailabilityDays={[]}
        initialSelectedDate={null}
        initialSlots={[]}
      />,
    );

    expect(screen.getAllByText("Duplicate description")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Class Summary" })).toBeInTheDocument();
    expect(screen.getByText("Duration: 60 minutes")).toBeInTheDocument();
    expect(screen.getByText("Teacher: Coach Marie")).toBeInTheDocument();
    expect(screen.getByText("Location: Studio Brussels")).toBeInTheDocument();
    expect(screen.queryByText(/Timezone:/i)).not.toBeInTheDocument();
  });

  it("selecting a day updates slots and empty day shows no availability", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);

      if (url.includes("/slots?date=2099-04-11")) {
        return {
          ok: true,
          json: async () => ({
            date: "2099-04-11",
            timezone: "Europe/Brussels",
            slots: [],
          }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({
          date: "2099-04-10",
          timezone: "Europe/Brussels",
          slots: [
              {
                id: "slot-1",
                date: "2099-04-10",
                startTime: "18:00",
                endTime: "19:00",
                capacity: 12,
                availableSpots: 4,
                isAvailable: true,
                isWaitlistSupported: true,
                isWaitlistAvailable: false,
                waitlistSpotsLeft: 6,
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
          classSummary: {
            title: "Class Summary",
            duration: "60 minutes",
            teacher: "Coach Marie",
            location: "Studio Brussels",
          },
        }}
        initialMonthKey="2099-04"
        initialAvailabilityDays={[
          { date: "2099-04-10", totalSlots: 1, availableSlots: 1, hasAvailability: true },
          { date: "2099-04-11", totalSlots: 1, availableSlots: 0, hasAvailability: true },
        ]}
        initialSelectedDate="2099-04-10"
        initialSlots={[
          {
            id: "slot-1",
            date: "2099-04-10",
            startTime: "18:00",
            endTime: "19:00",
            capacity: 12,
            availableSpots: 4,
            isAvailable: true,
            isWaitlistSupported: true,
            isWaitlistAvailable: false,
            waitlistSpotsLeft: 6,
          },
        ]}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Select 2099-04-11" }));

    await waitFor(() => {
      expect(screen.getByText("No availability on this date.")).toBeInTheDocument();
    });

    expect(fetchSpy).toHaveBeenCalledWith("/api/services/vinyasa-yoga/slots?date=2099-04-11");
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
              isWaitlistSupported: true,
              isWaitlistAvailable: false,
              waitlistSpotsLeft: 5,
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
                isWaitlistSupported: true,
                isWaitlistAvailable: false,
                waitlistSpotsLeft: 5,
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
          classSummary: {
            title: "Class Summary",
            duration: "60 minutes",
            teacher: "Coach Marie",
            location: "Studio Brussels",
          },
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

  it("shows Join Waitlist CTA for full slot with waitlist and handles success", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/waitlist/join")) {
        return {
          ok: true,
          json: async () => ({
            waitlist: { waitlistEntryId: "waitlist_1", joined: true },
          }),
        } as Response;
      }

      if (url.includes("/slots?date=2026-04-20")) {
        return {
          ok: true,
          json: async () => ({
            date: "2026-04-20",
            timezone: "Europe/Brussels",
            slots: [
              {
                id: "slot-full-1",
                date: "2026-04-20",
                startTime: "18:00",
                endTime: "19:00",
                capacity: 2,
                availableSpots: 0,
                isAvailable: false,
                isWaitlistSupported: true,
                isWaitlistAvailable: true,
                waitlistSpotsLeft: 1,
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
          classSummary: {
            title: "Class Summary",
            duration: "60 minutes",
            teacher: "Coach Marie",
            location: "Studio Brussels",
          },
        }}
        initialMonthKey="2026-04"
        initialAvailabilityDays={[
          { date: "2026-04-20", totalSlots: 1, availableSlots: 0, hasAvailability: true },
        ]}
        initialSelectedDate="2026-04-20"
        initialSlots={[
          {
            id: "slot-full-1",
            date: "2026-04-20",
            startTime: "18:00",
            endTime: "19:00",
            capacity: 2,
            availableSpots: 0,
            isAvailable: false,
            isWaitlistSupported: true,
            isWaitlistAvailable: true,
            waitlistSpotsLeft: 1,
          },
        ]}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /Join waitlist for slot 18:00 to 19:00/i }));

    await waitFor(() => {
      expect(screen.getByText("You have been added to the waitlist.")).toBeInTheDocument();
    });

    expect(fetchSpy).toHaveBeenCalledWith("/api/waitlist/join", expect.objectContaining({
      method: "POST",
    }));
    expect(screen.getByRole("button", { name: /Join waitlist for slot 18:00 to 19:00/i })).toBeDisabled();
    expect(screen.queryByText(/position/i)).not.toBeInTheDocument();
  });

  it("shows full slot state when waitlist is unavailable", () => {
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
          classSummary: {
            title: "Class Summary",
            duration: "60 minutes",
            teacher: "Coach Marie",
            location: "Studio Brussels",
          },
        }}
        initialMonthKey="2026-04"
        initialAvailabilityDays={[
          { date: "2026-04-21", totalSlots: 1, availableSlots: 0, hasAvailability: true },
        ]}
        initialSelectedDate="2026-04-21"
        initialSlots={[
          {
            id: "slot-full-2",
            date: "2026-04-21",
            startTime: "20:00",
            endTime: "21:00",
            capacity: 1,
            availableSpots: 0,
            isAvailable: false,
            isWaitlistSupported: true,
            isWaitlistAvailable: false,
            waitlistSpotsLeft: 0,
          },
        ]}
      />,
    );

    expect(screen.getByText("Session is full. Waitlist is currently full.")).toBeInTheDocument();
    expect(screen.getByText("Waitlist Full")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Join waitlist/i })).not.toBeInTheDocument();
  });
});
