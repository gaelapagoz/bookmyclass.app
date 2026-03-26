/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import NavbarClient from "../../src/components/NavbarClient";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({
    push: pushMock,
  }),
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

  it("mobile About submenu item navigates with router push", () => {
    pushMock.mockReset();
    render(<NavbarClient isAuthenticated={false} onSignOutAction={vi.fn(async () => undefined)} />);

    fireEvent.click(screen.getByRole("button", { name: "Toggle navigation menu" }));
    const aboutButtons = screen.getAllByRole("button", { name: /about us/i });
    fireEvent.click(aboutButtons[aboutButtons.length - 1] as HTMLElement);

    fireEvent.click(screen.getByRole("menuitem", { name: "Our Studio" }));

    expect(pushMock).toHaveBeenCalledWith("/about/studio");
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
});
