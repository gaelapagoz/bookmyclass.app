/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/admin/(private)/actions", () => ({
  updateLearningVideoAction: vi.fn(),
  createLearningVideoAction: vi.fn(),
  updateLearningProgramAction: vi.fn(),
  createLearningProgramAction: vi.fn(),
}));

vi.mock("@/lib/admin/admin-catalog-core-service", () => ({
  getAdminLearningVideoById: vi.fn(async () => ({
    id: "video-1",
    legacyId: "course-1",
    title: "01 - How do my backbend series work?",
    description: "Video description",
    shortDescription: "Short description",
    category: "Backbends Series",
    thumbnail: "/uploads/learning/01-how-do-my-backbend-series-work.jpg",
    videoUrl: "https://www.youtube.com/watch?v=OLxyHlbyqo4",
    priority: 1,
  })),
  getAdminLearningProgramCourseTypeOptions: vi.fn(async () => ["Backbends Series", "Body Sculpting Pilates Series", "Online Yoga Classes"]),
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
  getLearningMediaLibraryOptions: vi.fn(async () => []),
}));

import AdminLearningVideoEditPage from "../../src/app/admin/(private)/learning-videos/[id]/edit/page";
import AdminLearningVideoCreatePage from "../../src/app/admin/(private)/learning-videos/new/page";
import AdminLearningProgramEditPage from "../../src/app/admin/(private)/learning-programs/[id]/edit/page";
import AdminLearningProgramCreatePage from "../../src/app/admin/(private)/learning-programs/new/page";

describe("admin learning video edit page", () => {
  it("renders title, back link, upload controls, helper text, preview, and submit copy", async () => {
    render(
      await AdminLearningVideoEditPage({
        params: Promise.resolve({ id: "video-1" }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.getByRole("heading", { name: "Edit Learning Video" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to learning videos" })).toBeInTheDocument();
    expect(screen.getByTestId("admin-learning-video-edit-form")).toBeInTheDocument();
    expect(screen.getByTestId("learning-video-thumbnail-upload")).toBeInTheDocument();
    expect(screen.getByText(/Recommended 1600.*900 .* JPG or PNG .* < 2 MB/)).toBeInTheDocument();
    expect(screen.getByTestId("learning-video-thumbnail-preview")).toBeInTheDocument();
    expect(screen.getByTestId("learning-video-update-submit")).toHaveTextContent("Update learning video");
    expect(screen.getByLabelText("Course Type")).toBeInTheDocument();
    expect(screen.queryByLabelText("Category Type")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Category Level")).not.toBeInTheDocument();
  });

  it("renders course type as select with program-backed options and selected value", async () => {
    render(
      await AdminLearningVideoEditPage({
        params: Promise.resolve({ id: "video-1" }),
        searchParams: Promise.resolve({}),
      }),
    );

    const select = screen.getByTestId("learning-video-course-type");
    expect(select.tagName).toBe("SELECT");
    expect(select).toHaveValue("Backbends Series");
    expect(screen.getByRole("option", { name: "Backbends Series" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Body Sculpting Pilates Series" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Online Yoga Classes" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Backbend" })).not.toBeInTheDocument();
  });

  it("prefills existing values and renders thumbnail filename/preview", async () => {
    render(
      await AdminLearningVideoEditPage({
        params: Promise.resolve({ id: "video-1" }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.getByTestId("learning-video-title")).toHaveValue("01 - How do my backbend series work?");
    expect(screen.getByTestId("learning-video-description")).toHaveValue("Video description");
    expect(screen.getByTestId("learning-video-short-description")).toHaveValue("Short description");
    expect(screen.getByTestId("learning-video-video-url")).toHaveValue("https://www.youtube.com/watch?v=OLxyHlbyqo4");
    expect(screen.getByTestId("learning-video-priority")).toHaveValue(1);
    expect(screen.getByText("Current file: 01-how-do-my-backbend-series-work.jpg")).toBeInTheDocument();
    expect(screen.getByAltText("Current thumbnail preview")).toBeInTheDocument();
    expect(screen.getByTestId("learning-video-video-preview")).toBeInTheDocument();
  });

  it("renders thumbnail and video as left-input/right-preview sections and keeps priority in normal flow", async () => {
    const { container } = render(
      await AdminLearningVideoEditPage({
        params: Promise.resolve({ id: "video-1" }),
        searchParams: Promise.resolve({}),
      }),
    );

    const thumbUpload = screen.getByTestId("learning-video-thumbnail-upload");
    const thumbPreview = screen.getByTestId("learning-video-thumbnail-preview");
    expect(thumbUpload.compareDocumentPosition(thumbPreview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const videoUrl = screen.getByTestId("learning-video-video-url");
    const videoPreview = screen.getByTestId("learning-video-video-preview");
    expect(videoUrl.compareDocumentPosition(videoPreview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const priority = screen.getByTestId("learning-video-priority");
    expect(videoPreview.contains(priority)).toBe(false);

    const dividers = container.querySelectorAll('div[class*="border-t"][class*="border-[#d3dbe5]"]');
    expect(dividers.length).toBeGreaterThanOrEqual(2);
  });

  it("learning function server-action forms do not specify explicit method or encType", async () => {
    const { container: videoEditContainer } = render(
      await AdminLearningVideoEditPage({
        params: Promise.resolve({ id: "video-1" }),
        searchParams: Promise.resolve({}),
      }),
    );
    const { container: videoCreateContainer } = render(
      await AdminLearningVideoCreatePage({
        searchParams: Promise.resolve({}),
      }),
    );
    const { container: programEditContainer } = render(
      await AdminLearningProgramEditPage({
        params: Promise.resolve({ id: "program-1" }),
        searchParams: Promise.resolve({}),
      }),
    );
    const { container: programCreateContainer } = render(
      await AdminLearningProgramCreatePage({
        searchParams: Promise.resolve({}),
      }),
    );

    const forms = [
      videoEditContainer.querySelector('form[data-testid="admin-learning-video-edit-form"]'),
      videoCreateContainer.querySelector("form"),
      programEditContainer.querySelector('form[data-testid="admin-learning-program-edit-form"]'),
      programCreateContainer.querySelector("form"),
    ];

    for (const form of forms) {
      expect(form).toBeTruthy();
      expect(form?.getAttribute("method")).toBeNull();
      expect(form?.getAttribute("encType")).toBeNull();
    }
  });
});


