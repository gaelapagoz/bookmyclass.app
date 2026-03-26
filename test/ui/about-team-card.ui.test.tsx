/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TeacherCard } from "../../src/components/about/TeacherCard";

describe("TeacherCard", () => {
  it("renders fallback when image URL is missing", () => {
    render(
      <TeacherCard
        instructor={{
          id: "teacher_1",
          name: "Ana Dupont",
          bio: "Yoga and mobility teacher.",
          imageUrl: "",
        }}
      />,
    );

    expect(screen.getByText("Instructor photo coming soon")).toBeInTheDocument();
    expect(screen.getByText("Ana Dupont")).toBeInTheDocument();
  });
});
