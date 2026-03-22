/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { notFoundMock } = vi.hoisted(() => ({
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/navigation", () => ({
  notFound: notFoundMock,
}));

vi.mock("@/lib/learning/catalogue", () => ({
  fromCourseTypeRouteKey: vi.fn((value: string) => decodeURIComponent(value)),
  getLearningProgramByCourseType: vi.fn(),
  getLearningCoursesByCourseType: vi.fn(),
}));

vi.mock("@/components/learning/LearningProgramDetail", () => ({
  default: ({
    program,
    courses,
  }: {
    program: { mainTitle: string };
    courses: Array<{ legacyId: string }>;
  }) => (
    <div data-testid="learning-program-detail">
      {program.mainTitle} ({courses.length})
    </div>
  ),
}));

import {
  getLearningCoursesByCourseType,
  getLearningProgramByCourseType,
} from "@/lib/learning/catalogue";
import LearningProgramPage from "../../src/app/(public)/learning/[courseType]/page";

describe("/learning/[courseType] page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders program and related courses for valid courseType", async () => {
    vi.mocked(getLearningProgramByCourseType).mockResolvedValue({
      legacyId: "1",
      mainTitle: "Yoga Program",
      mainDescription: "desc",
      courseType: "Yoga",
      title: "Yoga Program",
      description1: null,
      description2: null,
      description3: null,
      videoPromo: null,
      picture1: null,
      picture2: null,
      picture3: null,
    });
    vi.mocked(getLearningCoursesByCourseType).mockResolvedValue([
      {
        legacyId: "c1",
        title: "Course 1",
        description: null,
        shortDescription: null,
        category: "Yoga",
        categoryType: null,
        categoryLevel: null,
        thumbnail: null,
        videoUrl: null,
        priority: 1,
      },
    ]);

    render(
      await LearningProgramPage({
        params: Promise.resolve({ courseType: "Yoga%20Program" }),
      }),
    );

    expect(getLearningProgramByCourseType).toHaveBeenCalledWith("Yoga Program");
    expect(getLearningCoursesByCourseType).toHaveBeenCalledWith("Yoga");
    expect(screen.getByTestId("learning-program-detail")).toHaveTextContent("Yoga Program (1)");
  });

  it("triggers notFound for invalid courseType", async () => {
    vi.mocked(getLearningProgramByCourseType).mockResolvedValue(null);

    await expect(
      LearningProgramPage({
        params: Promise.resolve({ courseType: "Unknown" }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });
});
