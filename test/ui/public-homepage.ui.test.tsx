/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/public-documents/agenda-document-service", () => ({
  getActiveAgendaPdfDocument: vi.fn(async () => null),
}));

vi.mock("@/lib/client-messages/client-message-service", () => ({
  createContactMessage: vi.fn(),
}));

vi.mock("@/lib/public-content/home-agenda-service", () => ({
  getHomeAgendaTableFromSchedule: vi.fn(async () => []),
}));

import { getHomeAgendaTableFromSchedule } from "@/lib/public-content/home-agenda-service";
import HomePage from "../../src/app/(public)/page";

describe("public homepage schedule", () => {
  it("renders weekly agenda from static schedule source with seven-day desktop layout", async () => {
    vi.mocked(getHomeAgendaTableFromSchedule).mockResolvedValue([
      { day: "Monday", classes: ["18:00-19:00 Pilates"] },
      { day: "Tuesday", classes: [] },
      { day: "Wednesday", classes: ["09:00-10:00 Rocket Yoga"] },
      { day: "Thursday", classes: [] },
      { day: "Friday", classes: ["21:00-22:00 Functional Training"] },
      { day: "Saturday", classes: [] },
      { day: "Sunday", classes: [] },
    ]);

    render(await HomePage({ searchParams: Promise.resolve({}) }));

    expect(vi.mocked(getHomeAgendaTableFromSchedule)).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "Weekly Agenda" })).toBeInTheDocument();
    expect(screen.getByText("18:00-19:00")).toBeInTheDocument();
    expect(screen.getByText("Pilates")).toBeInTheDocument();
    expect(screen.getAllByText("No classes").length).toBeGreaterThan(0);

    for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]) {
      expect(screen.getByRole("heading", { name: day })).toBeInTheDocument();
    }

    const weeklyGrid = document.querySelector("#agenda .grid.grid-cols-1.gap-4.md\\:grid-cols-2.lg\\:grid-cols-7");
    expect(weeklyGrid).not.toBeNull();
  });

  it("renders a stable hero container and full-width hero image sizing contract", async () => {
    render(await HomePage({ searchParams: Promise.resolve({}) }));

    const heroSection = screen.getByTestId("public-home-hero");
    expect(heroSection.className).toContain("w-full");
    expect(heroSection.className).toContain("isolate");
    expect(heroSection.className).toContain("min-h-[560px]");
    expect(heroSection.className).toContain("md:min-h-[78vh]");

    const heroImage = screen.getByAltText("Woman practicing front split in a calm natural setting");
    expect(heroImage).toHaveAttribute("sizes", "100vw");
    expect(heroImage.className).toContain("h-full");
    expect(heroImage.className).toContain("w-full");
    expect(heroImage.className).toContain("object-cover");
  });
});
