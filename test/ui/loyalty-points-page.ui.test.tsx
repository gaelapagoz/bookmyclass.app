/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import LoyaltyPointsPromoPage from "../../src/app/(public)/promos/loyalty-points/page";

describe("LoyaltyPointsPromoPage", () => {
  it("renders the public loyalty explainer content", () => {
    render(<LoyaltyPointsPromoPage />);

    expect(screen.getByRole("heading", { name: "Loyalty Points" })).toBeInTheDocument();
    expect(screen.getByText(/earn on eligible settled purchases/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /how it works right now/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view your dashboard/i })).toHaveAttribute("href", "/dashboard");
    expect(screen.queryByText(/reference-only scaffold/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/later-stage reference/i)).not.toBeInTheDocument();
  });
});
