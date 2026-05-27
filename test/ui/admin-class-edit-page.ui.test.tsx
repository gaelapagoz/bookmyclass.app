/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { notFoundMock } = vi.hoisted(() => ({
  notFoundMock: vi.fn(() => {
    const error = new Error("NEXT_NOT_FOUND");
    (error as Error & { digest?: string }).digest = "NEXT_HTTP_ERROR_FALLBACK;404";
    throw error;
  }),
}));

vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return {
    ...actual,
    notFound: notFoundMock,
  };
});

vi.mock("@/app/admin/(private)/actions", () => ({
  updateClassAction: vi.fn(),
  uploadClassImageAction: vi.fn(),
}));

vi.mock("@/lib/admin/admin-catalog-core-service", () => ({
  getAdminClassById: vi.fn(async () => ({
    id: "class-1",
    categoryId: "cat-1",
    name: "Morning Flow",
    slug: "morning-flow",
    imageUrl: "/uploads/classes/morning-flow.jpg",
    description: "desc",
    defaultDurationMinutes: 60,
    defaultCapacity: 12,
    isActive: true,
    isVisible: true,
    sortOrder: 1,
    schedule: {
      defaultTeacherId: "teacher-1",
      startTime: "09:00",
      endTime: "10:00",
      isRecurring: true,
      date: "2026-04-01",
      weekdays: ["MONDAY", "WEDNESDAY"],
      endDate: "2026-06-01",
    },
  })),
  getClassCategoryOptions: vi.fn(async () => [{ id: "cat-1", name: "Yoga" }]),
  getAdminClassScheduleOptions: vi.fn(async () => [{ id: "teacher-1", name: "Teacher One" }]),
}));

import AdminClassEditPage from "../../src/app/admin/(private)/classes/[id]/edit/page";

describe("admin class edit page", () => {
  it("hides slug, removes week/ends/occurrences controls, and renders image panel", async () => {
    render(
      await AdminClassEditPage({
        params: Promise.resolve({ id: "class-1" }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.queryByLabelText("Slug")).not.toBeInTheDocument();
    expect(screen.queryByText("Ends")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Occurrences")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Never")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("On")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("After")).not.toBeInTheDocument();
    expect(screen.queryByText(/Repeat every/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: /week/i })).not.toBeInTheDocument();

    expect(screen.getByLabelText("Default Teacher")).toBeInTheDocument();
    expect(screen.getByLabelText("Start Time")).toBeInTheDocument();
    expect(screen.getByLabelText("End Time")).toBeInTheDocument();
    expect(screen.getByLabelText("Start Date")).toBeInTheDocument();
    expect(screen.getByLabelText("End Date")).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "Service Image" })).toBeInTheDocument();
    expect(screen.getByTestId("class-image-preview")).toHaveAttribute("src", "/uploads/classes/morning-flow.jpg");
    expect(screen.getByTestId("class-image-preview-container")).toBeInTheDocument();
  });

  it("rehydrates persisted weekdays and keeps selection when clicking", async () => {
    render(
      await AdminClassEditPage({
        params: Promise.resolve({ id: "class-1" }),
        searchParams: Promise.resolve({}),
      }),
    );

    const monday = screen.getByLabelText("Mon") as HTMLInputElement;
    const wednesday = screen.getByLabelText("Wed") as HTMLInputElement;
    const friday = screen.getByLabelText("Fri") as HTMLInputElement;

    expect(monday).toBeChecked();
    expect(wednesday).toBeChecked();
    expect(friday).not.toBeChecked();

    fireEvent.click(friday);
    expect(friday).toBeChecked();
  });
});

