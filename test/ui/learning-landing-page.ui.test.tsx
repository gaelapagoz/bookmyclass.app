/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/learning/catalogue", () => ({
  getLearningPrograms: vi.fn(),
}));

vi.mock("@/components/learning/LearningProgramsSection", () => ({
  default: ({ programs }: { programs: Array<{ mainTitle: string }> }) => (
    <div data-testid="learning-programs">Programs: {programs.length}</div>
  ),
}));

import { getLearningPrograms } from "@/lib/learning/catalogue";
import LearningPage from "../../src/app/(public)/learning/page";

describe("/learning page", () => {
  it("renders programs when data exists", async () => {
    vi.mocked(getLearningPrograms).mockResolvedValue([
      {
        legacyId: "1",
        mainTitle: "Program A",
        mainDescription: "desc",
        courseType: "Yoga",
        title: "Program A",
        description1: null,
        description2: null,
        description3: null,
        videoPromo: null,
        picture1: null,
        picture2: null,
        picture3: null,
      },
    ]);

    render(await LearningPage());

    expect(screen.getByTestId("learning-programs")).toHaveTextContent("Programs: 1");
  });

  it("shows empty state when no programs exist", async () => {
    vi.mocked(getLearningPrograms).mockResolvedValue([]);

    render(await LearningPage());

    expect(
      screen.getByText("No learning programs are available right now. Please check back soon."),
    ).toBeInTheDocument();
  });

  it("shows unavailable fallback when loading fails", async () => {
    vi.mocked(getLearningPrograms).mockRejectedValue(new Error("db unavailable"));

    render(await LearningPage());

    expect(
      screen.getByText("Learning programs are temporarily unavailable. Please try again shortly."),
    ).toBeInTheDocument();
  });
});
