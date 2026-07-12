/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Footer from "../../src/components/Footer";

vi.mock("next/image", () => ({
  default: ({ alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt ?? ""} {...props} />
  ),
}));

describe("Footer social icons", () => {
  it("keeps social icons visible without exposing them as links or focus targets", () => {
    const { container } = render(<Footer />);
    const footer = screen.getByRole("contentinfo");
    const followSection = within(footer).getByText("Follow us").parentElement;

    expect(followSection).toBeTruthy();

    for (const name of ["facebook", "instagram", "youtube"]) {
      const icon = screen.getByTestId(`footer-social-icon-${name}`);
      expect(icon).toBeInTheDocument();
      expect(icon.tagName).toBe("SPAN");
      expect(icon).toHaveAttribute("aria-hidden", "true");
      expect(icon).not.toHaveAttribute("tabindex");
      expect(icon.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    }

    const socialAnchors = followSection?.querySelectorAll(
      'a[href*="facebook"], a[href*="instagram"], a[href*="youtube"], a[href*="youtu.be"]',
    );
    expect(socialAnchors).toHaveLength(0);

    const focusableSocialIcons = followSection?.querySelectorAll(
      '[data-testid^="footer-social-icon-"][href], [data-testid^="footer-social-icon-"][tabindex], [data-testid^="footer-social-icon-"] a',
    );
    expect(focusableSocialIcons).toHaveLength(0);

    expect(container.innerHTML).not.toContain("facebook.com");
    expect(container.innerHTML).not.toContain("instagram.com");
    expect(container.innerHTML).not.toContain("youtube.com");
    expect(container.innerHTML).not.toContain("youtu.be");
  });
});
