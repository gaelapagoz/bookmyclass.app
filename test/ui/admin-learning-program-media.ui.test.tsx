/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/admin/(private)/actions", () => ({
  createLearningProgramAction: vi.fn(),
  updateLearningProgramAction: vi.fn(),
}));

vi.mock("@/lib/admin/admin-service", () => ({
  getAdminLearningProgramById: vi.fn(async () => ({
    id: "program-1",
    legacyId: "legacy-1",
    mainTitle: "Main Program",
    mainDescription: "Main description",
    courseType: "Yoga",
    title: "Program Title",
    description1: null,
    description2: null,
    description3: null,
    videoPromo: null,
    picture1: "/images/learning/library.png",
    picture2: null,
    picture3: null,
  })),
  getLearningMediaLibraryOptions: vi.fn(async () => [
    { path: "/images/learning/library.png", name: "library.png" },
    { path: "/images/learning/second.webp", name: "second.webp" },
  ]),
}));

import AdminLearningProgramEditPage from "../../src/app/admin/(private)/learning-programs/[id]/edit/page";
import AdminLearningProgramCreatePage from "../../src/app/admin/(private)/learning-programs/new/page";

describe("admin learning program media controls", () => {
  it("renders library selectors and upload controls on create", async () => {
    const { container } = render(
      await AdminLearningProgramCreatePage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.getAllByRole("combobox")).toHaveLength(3);
    expect(screen.getAllByRole("option", { name: "library.png" })).toHaveLength(3);
    expect(container.querySelector('input[name="picture1Upload"]')).toHaveAttribute("type", "file");
    expect(container.querySelector('input[name="picture2Upload"]')).toHaveAttribute("type", "file");
    expect(container.querySelector('input[name="picture3Upload"]')).toHaveAttribute("type", "file");
  });

  it("renders current library selection and upload controls on edit", async () => {
    const { container } = render(
      await AdminLearningProgramEditPage({
        params: Promise.resolve({ id: "program-1" }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.getAllByRole("combobox")[0]).toHaveValue("/images/learning/library.png");
    expect(screen.getAllByRole("option", { name: "second.webp" })).toHaveLength(3);
    expect(container.querySelector('input[name="picture1Upload"]')).toHaveAttribute("type", "file");
  });
});
