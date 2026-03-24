/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicCatalogue } from "../../src/components/book-a-class/PublicCatalogue";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PublicCatalogue", () => {
  it("shows the default category services on first render", () => {
    render(
      <PublicCatalogue
        categories={[
          { slug: "yoga", name: "Yoga" },
          { slug: "pilates", name: "Pilates" },
        ]}
        initialCategorySlug="yoga"
        initialServices={[
          {
            id: "service-1",
            slug: "vinyasa-yoga",
            title: "Vinyasa Yoga",
            description: "Full Vinyasa class description",
            shortDescription: "Flow-based yoga class",
            imageUrl: null,
            durationMinutes: 60,
            weekdaySummary: "Mon, Wed",
            pricingMode: "SINGLE_OR_PLAN",
          },
        ]}
      />,
    );

    expect(screen.getByRole("heading", { name: "Vinyasa Yoga" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Explore plans/i })).not.toBeInTheDocument();
    expect(
      screen.queryByText("No active services are currently available for this category."),
    ).not.toBeInTheDocument();
  });

  it("loads services when switching category", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        services: [
          {
            id: "service-2",
            slug: "mat-pilates",
            title: "Mat Pilates",
            description: "Mat Pilates full description",
            shortDescription: "Core and posture focus",
            imageUrl: null,
            durationMinutes: 50,
            weekdaySummary: "Tue, Thu",
            pricingMode: "SINGLE_ONLY",
          },
        ],
      }),
    } as Response);

    render(
      <PublicCatalogue
        categories={[
          { slug: "yoga", name: "Yoga" },
          { slug: "pilates", name: "Pilates" },
        ]}
        initialCategorySlug="yoga"
        initialServices={[
          {
            id: "service-1",
            slug: "vinyasa-yoga",
            title: "Vinyasa Yoga",
            description: "Full Vinyasa class description",
            shortDescription: "Flow-based yoga class",
            imageUrl: null,
            durationMinutes: 60,
            weekdaySummary: "Mon, Wed",
            pricingMode: "SINGLE_OR_PLAN",
          },
        ]}
      />,
    );

    await userEvent.click(screen.getByRole("tab", { name: "Show Pilates classes" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Mat Pilates" })).toBeInTheDocument();
    });

    expect(fetchSpy).toHaveBeenCalledWith("/api/services?category=pilates");
  });

  it("shows empty state when selected category has no services", () => {
    render(
      <PublicCatalogue
        categories={[{ slug: "yoga", name: "Yoga" }]}
        initialCategorySlug="yoga"
        initialServices={[]}
      />,
    );

    expect(
      screen.getByText("No active services are currently available for this category."),
    ).toBeInTheDocument();
  });
});
