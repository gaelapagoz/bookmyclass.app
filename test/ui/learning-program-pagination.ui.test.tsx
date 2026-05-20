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
    courses,
    currentPage,
    totalPages,
  }: {
    courses: Array<{ legacyId: string }>;
    currentPage: number;
    totalPages: number;
  }) => (
    <div data-testid="learning-pagination-props">
      page={currentPage};total={totalPages};courses={courses.map((course) => course.legacyId).join(",")}
    </div>
  ),
}));

import {
  getLearningCoursesByCourseType,
  getLearningProgramByCourseType,
} from "@/lib/learning/catalogue";
import LearningProgramPage from "../../src/app/(public)/learning/[courseType]/page";

function makeCourses(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    legacyId: `c${index + 1}`,
    title: `Course ${index + 1}`,
    description: null,
    shortDescription: null,
    category: "Yoga Program",
    thumbnail: null,
    videoUrl: null,
    priority: index + 1,
  }));
}

describe("/learning/[courseType] pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(getLearningProgramByCourseType).mockResolvedValue({
      legacyId: "p1",
      courseType: "Yoga Program",
      mainDescription: "desc",
      description1: null,
      description2: null,
      description3: null,
      videoPromo: null,
      picture1: null,
      picture2: null,
      picture3: null,
    });
  });

  it("defaults to page 1 when page query is missing", async () => {
    vi.mocked(getLearningCoursesByCourseType).mockResolvedValue(makeCourses(14));

    render(
      await LearningProgramPage({
        params: Promise.resolve({ courseType: "Yoga%20Program" }),
      }),
    );

    expect(screen.getByTestId("learning-pagination-props")).toHaveTextContent(
      "page=1;total=3;courses=c1,c2,c3,c4,c5,c6",
    );
  });

  it("returns requested middle page when valid", async () => {
    vi.mocked(getLearningCoursesByCourseType).mockResolvedValue(makeCourses(14));

    render(
      await LearningProgramPage({
        params: Promise.resolve({ courseType: "Yoga%20Program" }),
        searchParams: Promise.resolve({ page: "2" }),
      }),
    );

    expect(screen.getByTestId("learning-pagination-props")).toHaveTextContent(
      "page=2;total=3;courses=c7,c8,c9,c10,c11,c12",
    );
  });

  it("clamps invalid or out-of-range page values to safe page", async () => {
    vi.mocked(getLearningCoursesByCourseType).mockResolvedValue(makeCourses(14));

    const invalid = await LearningProgramPage({
      params: Promise.resolve({ courseType: "Yoga%20Program" }),
      searchParams: Promise.resolve({ page: "abc" }),
    });
    render(invalid);
    expect(screen.getByTestId("learning-pagination-props")).toHaveTextContent(
      "page=1;total=3;courses=c1,c2,c3,c4,c5,c6",
    );

    const outOfRange = await LearningProgramPage({
      params: Promise.resolve({ courseType: "Yoga%20Program" }),
      searchParams: Promise.resolve({ page: "999" }),
    });
    render(outOfRange);
    expect(screen.getAllByTestId("learning-pagination-props")[1]).toHaveTextContent(
      "page=3;total=3;courses=c13,c14",
    );
  });
});

