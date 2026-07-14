/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

import { DashboardNav } from "../../src/components/dashboard/DashboardNav";

describe("DashboardNav", () => {
  it("renders the beta dashboard structure with no duplicate security entry", () => {
    render(<DashboardNav />);

    expect(screen.getByRole("link", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "My Bookings" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Memberships & Packs" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Purchases" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "My Wallet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "My Profile" })).toBeInTheDocument();

    expect(screen.queryByRole("link", { name: "Change Password" })).not.toBeInTheDocument();
  });

  it("links Purchases to /dashboard/orders", () => {
    render(<DashboardNav />);
    expect(screen.getByRole("link", { name: "Purchases" })).toHaveAttribute("href", "/dashboard/orders");
  });
});
