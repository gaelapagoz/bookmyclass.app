/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/admin/(private)/actions", () => ({
  createClassAction: vi.fn(),
}));

vi.mock("@/lib/admin/admin-catalog-core-service", () => ({
  getAdminClassScheduleOptions: vi.fn(async () => [{ id: "teacher-1", name: "Teacher One" }]),
  getClassCategoryOptions: vi.fn(async () => [{ id: "cat-1", name: "Yoga" }]),
}));

import AdminClassCreatePage from "../../src/app/admin/(private)/classes/new/page";

describe("admin class create page", () => {
  it("removes manual slug entry and requires service image upload", async () => {
    render(
      await AdminClassCreatePage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.queryByLabelText("Slug")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Service Image")).toHaveAttribute("type", "file");
  });
});

