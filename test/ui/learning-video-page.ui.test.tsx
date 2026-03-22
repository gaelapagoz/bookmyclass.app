/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { notFoundMock } = vi.hoisted(() => ({
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return {
    ...actual,
    notFound: notFoundMock,
    useRouter: () => ({
      push: vi.fn(),
      refresh: vi.fn(),
      replace: vi.fn(),
      prefetch: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
    }),
  };
});

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/learning/catalogue", () => ({
  fromCourseTypeRouteKey: vi.fn((value: string) => decodeURIComponent(value)),
  toCourseTypeRouteKey: vi.fn((value: string) => encodeURIComponent(value)),
  getLearningProgramByCourseType: vi.fn(),
  getLearningCourseByCourseTypeAndLegacyId: vi.fn(),
  toEmbedUrl: vi.fn((value: string | null) => value),
}));

import { auth } from "@/auth";
import {
  getLearningCourseByCourseTypeAndLegacyId,
  getLearningProgramByCourseType,
} from "@/lib/learning/catalogue";
import LearningCoursePage from "../../src/app/(public)/learning/[courseType]/[courseId]/page";

describe("/learning/[courseType]/[courseId] page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("authenticated user can see playable video area", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u1" } } as never);
    vi.mocked(getLearningProgramByCourseType).mockResolvedValue({
      legacyId: "1",
      mainTitle: "Yoga Program",
      mainDescription: null,
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
    vi.mocked(getLearningCourseByCourseTypeAndLegacyId).mockResolvedValue({
      legacyId: "course-1",
      title: "Morning Flow",
      description: "desc",
      shortDescription: null,
      category: "Yoga",
      categoryType: null,
      categoryLevel: null,
      thumbnail: null,
      videoUrl: "https://www.youtube.com/embed/abc123",
      priority: 1,
    });

    render(
      await LearningCoursePage({
        params: Promise.resolve({
          courseType: "Yoga",
          courseId: "course-1",
        }),
      }),
    );

    expect(screen.getByTitle("Morning Flow")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign In To Watch" })).not.toBeInTheDocument();
  });

  it("unauthenticated user sees auth gate trigger instead of playable video", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    vi.mocked(getLearningProgramByCourseType).mockResolvedValue({
      legacyId: "1",
      mainTitle: "Yoga Program",
      mainDescription: null,
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
    vi.mocked(getLearningCourseByCourseTypeAndLegacyId).mockResolvedValue({
      legacyId: "course-1",
      title: "Morning Flow",
      description: "desc",
      shortDescription: null,
      category: "Yoga",
      categoryType: null,
      categoryLevel: null,
      thumbnail: null,
      videoUrl: "https://www.youtube.com/embed/abc123",
      priority: 1,
    });

    render(
      await LearningCoursePage({
        params: Promise.resolve({
          courseType: "Yoga",
          courseId: "course-1",
        }),
      }),
    );

    expect(screen.getByRole("button", { name: "Sign In To Watch" })).toBeInTheDocument();
    expect(screen.queryByTitle("Morning Flow")).not.toBeInTheDocument();
  });

  it("invalid course/program combination triggers notFound", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    vi.mocked(getLearningProgramByCourseType).mockResolvedValue(null);
    vi.mocked(getLearningCourseByCourseTypeAndLegacyId).mockResolvedValue(null);

    await expect(
      LearningCoursePage({
        params: Promise.resolve({
          courseType: "Unknown",
          courseId: "missing",
        }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });
});
