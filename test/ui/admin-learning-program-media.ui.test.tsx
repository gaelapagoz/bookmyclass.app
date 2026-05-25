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
    mainDescription: "Main description",
    courseType: "Yoga",
    description1: null,
    description2: null,
    description3: null,
    videoPromo: null,
    picture1: "/uploads/learning/library.png",
    picture2: null,
    picture3: null,
  })),
  getLearningMediaLibraryOptions: vi.fn(async () => [
    { path: "/uploads/learning/library.png", name: "library.png" },
    { path: "/uploads/learning/second.webp", name: "second.webp" },
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

    const courseTypeInput = screen.getByTestId("learning-program-course-type");
    expect(courseTypeInput).toHaveValue("Yoga");
    expect(courseTypeInput.tagName).toBe("INPUT");
    expect(screen.queryByTestId("learning-program-main-title")).not.toBeInTheDocument();
    expect(screen.queryByTestId("learning-program-title")).not.toBeInTheDocument();
    expect(screen.getAllByRole("option", { name: "second.webp" })).toHaveLength(3);
    expect(container.querySelector('input[name="picture1Upload"]')).toHaveAttribute("type", "file");
  });

  it("renders edit layout fields in required order with helper text, previews, and submit copy", async () => {
    render(
      await AdminLearningProgramEditPage({
        params: Promise.resolve({ id: "program-1" }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.getByRole("heading", { name: "Edit Learning Program" })).toBeInTheDocument();
    expect(screen.getByTestId("admin-learning-program-edit-form")).toBeInTheDocument();
    expect(screen.getByText("YouTube, Vimeo, or direct mp4. Preview updates automatically.")).toBeInTheDocument();
    expect(screen.getAllByText(/Recommended 1600×900 · JPG or PNG · < 2 MB/)).toHaveLength(3);
    expect(screen.getByTestId("learning-program-picture-1-preview")).toBeInTheDocument();
    expect(screen.getByTestId("learning-program-picture-2-preview")).toBeInTheDocument();
    expect(screen.getByTestId("learning-program-picture-3-preview")).toBeInTheDocument();
    expect(screen.getByTestId("learning-program-update-submit")).toHaveTextContent("Update learning program");

    const order = [
      "Course Type",
      "Main Description",
      "Description 1",
      "Description 2",
      "Description 3",
      "Video Promo URL",
      "Picture 1",
      "Picture 2",
      "Picture 3",
      "Update learning program",
    ];
    const textContent = document.body.textContent ?? "";
    let cursor = -1;
    for (const marker of order) {
      const next = textContent.indexOf(marker, cursor + 1);
      expect(next).toBeGreaterThan(cursor);
      cursor = next;
    }
  });

  it("prefills existing program values including descriptions, video url, filenames, and picture previews", async () => {
    render(
      await AdminLearningProgramEditPage({
        params: Promise.resolve({ id: "program-1" }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.getByTestId("learning-program-course-type")).toHaveValue("Yoga");
    expect(screen.getByTestId("learning-program-main-description")).toHaveValue("Main description");
    expect(screen.getByTestId("learning-program-description-1")).toHaveValue("");
    expect(screen.getByTestId("learning-program-description-2")).toHaveValue("");
    expect(screen.getByTestId("learning-program-description-3")).toHaveValue("");
    expect(screen.getByTestId("learning-program-video-url")).toHaveValue("");

    expect(screen.getByTestId("learning-program-picture-1")).toHaveTextContent("Current file: library.png");
    expect(screen.getByTestId("learning-program-picture-2")).toHaveTextContent("Current file: No file selected");
    expect(screen.getByTestId("learning-program-picture-3")).toHaveTextContent("Current file: No file selected");

    expect(screen.getByAltText("Picture 1 preview")).toHaveAttribute(
      "src",
      expect.stringContaining(encodeURIComponent("/uploads/learning/library.png")),
    );
    expect(screen.getByTestId("learning-program-picture-2-preview")).toHaveTextContent("No image selected");
    expect(screen.getByTestId("learning-program-picture-3-preview")).toHaveTextContent("No image selected");
  });

  it("uses function server action form without explicit method or encType", async () => {
    const { container } = render(
      await AdminLearningProgramEditPage({
        params: Promise.resolve({ id: "program-1" }),
        searchParams: Promise.resolve({}),
      }),
    );

    const form = container.querySelector('form[data-testid="admin-learning-program-edit-form"]');
    expect(form).toBeTruthy();
    expect(form?.getAttribute("method")).toBeNull();
    expect(form?.getAttribute("encType")).toBeNull();
  });
});

