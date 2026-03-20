/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

function ExampleComponent() {
  return <p>Hello from UI test</p>;
}

describe("ui example", () => {
  it("renders text", () => {
    render(<ExampleComponent />);

    expect(screen.getByText("Hello from UI test")).toBeInTheDocument();
  });
});
