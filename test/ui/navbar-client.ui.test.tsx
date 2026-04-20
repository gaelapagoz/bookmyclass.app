/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import NavbarClient from "../../src/components/NavbarClient";
import { CART_STORAGE_KEY } from "../../src/lib/cart/cart-client";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

describe("NavbarClient", () => {
  it("shows About Us after Online Learning and opens submenu on click", () => {
    render(<NavbarClient isAuthenticated={false} onSignOutAction={vi.fn(async () => undefined)} />);

    const onlineLearning = screen.getByText("Online Learning");
    const aboutUsButton = screen.getByRole("button", { name: /about us/i });

    expect(onlineLearning.compareDocumentPosition(aboutUsButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(aboutUsButton);

    expect(screen.getByRole("menuitem", { name: "Our Studio" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Our Team" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Terms and Conditions" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "FAQ" })).toBeInTheDocument();
  });

  it("supports click toggle, outside click close, and ESC close", () => {
    render(<NavbarClient isAuthenticated={false} onSignOutAction={vi.fn(async () => undefined)} />);

    const aboutUsButton = screen.getByRole("button", { name: /about us/i });
    fireEvent.click(aboutUsButton);
    expect(screen.getByRole("menuitem", { name: "Our Studio" })).toBeInTheDocument();

    fireEvent.click(aboutUsButton);
    expect(screen.queryByRole("menuitem", { name: "Our Studio" })).not.toBeInTheDocument();

    fireEvent.click(aboutUsButton);
    expect(screen.getByRole("menuitem", { name: "Our Studio" })).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menuitem", { name: "Our Studio" })).not.toBeInTheDocument();

    fireEvent.click(aboutUsButton);
    expect(screen.getByRole("menuitem", { name: "Our Studio" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menuitem", { name: "Our Studio" })).not.toBeInTheDocument();
  });

  it("hides Dashboard when logged out", () => {
    render(<NavbarClient isAuthenticated={false} onSignOutAction={vi.fn(async () => undefined)} />);

    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
  });

  it("shows Dashboard when logged in", () => {
    render(<NavbarClient isAuthenticated={true} onSignOutAction={vi.fn(async () => undefined)} />);

    expect(screen.getByText("Dashboard")).toBeInTheDocument();
  });

  it("places Cart at the account-nav side before Sign In or Dashboard", () => {
    const { rerender } = render(
      <NavbarClient isAuthenticated={false} onSignOutAction={vi.fn(async () => undefined)} />,
    );

    const cartLinkLoggedOut = screen.getByRole("link", { name: /^Cart$/i });
    const signInLink = screen.getByRole("link", { name: /^Sign In$/i });
    expect(cartLinkLoggedOut.compareDocumentPosition(signInLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    rerender(<NavbarClient isAuthenticated={true} onSignOutAction={vi.fn(async () => undefined)} />);
    const cartLinkLoggedIn = screen.getByRole("link", { name: /^Cart$/i });
    const dashboardLink = screen.getByRole("link", { name: /^Dashboard$/i });
    expect(cartLinkLoggedIn.compareDocumentPosition(dashboardLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("mobile About submenu item is a real plain link", () => {
    render(<NavbarClient isAuthenticated={false} onSignOutAction={vi.fn(async () => undefined)} />);

    fireEvent.click(screen.getByRole("button", { name: "Toggle navigation menu" }));
    const aboutButtons = screen.getAllByRole("button", { name: /about us/i });
    fireEvent.click(aboutButtons[aboutButtons.length - 1] as HTMLElement);

    const studioLink = screen.getAllByRole("link", { name: "Our Studio" }).at(-1);
    expect(studioLink).toBeDefined();
    if (!studioLink) {
      throw new Error("Missing Our Studio link");
    }

    expect(studioLink.tagName).toBe("A");
    expect(studioLink).toHaveAttribute("href", "/about/studio");
  });

  it("mobile logout submits sign out action", async () => {
    const signOutAction = vi.fn(async () => undefined);
    render(<NavbarClient isAuthenticated={true} onSignOutAction={signOutAction} />);

    fireEvent.click(screen.getByRole("button", { name: "Toggle navigation menu" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Log Out" }).at(-1) as HTMLElement);

    await waitFor(() => {
      expect(signOutAction).toHaveBeenCalledTimes(1);
    });
  });

  it("renders cart badge in a hydration-safe way and updates on cart changes", async () => {
    window.localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        lines: [
          {
            productId: "prod_one",
            priceId: "price_one",
            productName: "One-time Pack",
            productDescription: null,
            productType: "CLASS_PACK",
            priceName: "Pack Price",
            priceType: "ONE_TIME",
            quantity: 2,
            unitAmountMinor: 2500,
            currencyCode: "EUR",
            billingInterval: null,
            billingIntervalCount: null,
          },
        ],
      }),
    );

    render(<NavbarClient isAuthenticated={false} onSignOutAction={vi.fn(async () => undefined)} />);

    await waitFor(() => {
      expect(screen.getByTestId("cart-badge")).toHaveTextContent("2");
    });

    window.localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        lines: [
          {
            productId: "prod_one",
            priceId: "price_one",
            productName: "One-time Pack",
            productDescription: null,
            productType: "CLASS_PACK",
            priceName: "Pack Price",
            priceType: "ONE_TIME",
            quantity: 3,
            unitAmountMinor: 2500,
            currencyCode: "EUR",
            billingInterval: null,
            billingIntervalCount: null,
          },
        ],
      }),
    );
    window.dispatchEvent(new Event("cart:updated"));

    await waitFor(() => {
      expect(screen.getByTestId("cart-badge")).toHaveTextContent("3");
    });
  });
});
