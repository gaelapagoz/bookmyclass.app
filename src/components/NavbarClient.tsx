"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { getClientCartItemCount, subscribeToClientCart } from "@/lib/cart/cart-client";
import { siteConfig } from "@/lib/site-config";
import {
  getHeaderAccountNavigation,
  getHeaderPrimaryNavigation,
} from "@/lib/navigation/site-header-nav";

type NavbarClientProps = {
  isAuthenticated: boolean;
  onSignOutAction: (formData: FormData) => Promise<void>;
};

function isActivePath(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

function linkClass(isActive: boolean) {
  return `text-sm tracking-wide transition-colors ${
    isActive ? "text-[#7b2d2d]" : "text-[#8a5959] hover:text-[#7b2d2d]"
  }`;
}

export default function NavbarClient({ isAuthenticated, onSignOutAction }: NavbarClientProps) {
  const pathname = usePathname();

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isDesktopAboutOpen, setIsDesktopAboutOpen] = useState(false);
  const [isCartHydrated, setIsCartHydrated] = useState(false);
  const [cartItemCount, setCartItemCount] = useState(0);

  const desktopAboutRef = useRef<HTMLDivElement | null>(null);

  const primaryItems = useMemo(() => getHeaderPrimaryNavigation(), []);
  const accountItems = useMemo(() => getHeaderAccountNavigation({ isAuthenticated }), [isAuthenticated]);

  useEffect(() => {
    setIsMobileMenuOpen(false);
    setIsAboutOpen(false);
    setIsDesktopAboutOpen(false);
  }, [pathname, isAuthenticated]);

  useEffect(() => {
    function onOutsideClick(event: MouseEvent) {
      if (!isDesktopAboutOpen || !desktopAboutRef.current) {
        return;
      }

      const target = event.target as Node | null;
      if (target && !desktopAboutRef.current.contains(target)) {
        setIsDesktopAboutOpen(false);
      }
    }

    function onEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsDesktopAboutOpen(false);
      }
    }

    document.addEventListener("mousedown", onOutsideClick);
    document.addEventListener("keydown", onEscape);

    return () => {
      document.removeEventListener("mousedown", onOutsideClick);
      document.removeEventListener("keydown", onEscape);
    };
  }, [isDesktopAboutOpen]);

  useEffect(() => {
    const sync = () => {
      setCartItemCount(getClientCartItemCount());
    };

    sync();
    setIsCartHydrated(true);
    return subscribeToClientCart(sync);
  }, []);

  const renderCartBadge = (href: string) => {
    if (href !== "/cart" || !isCartHydrated || cartItemCount <= 0) {
      return null;
    }

    return (
      <span
        data-testid="cart-badge"
        className="inline-flex min-w-5 items-center justify-center rounded-full bg-[#7b2d2d] px-1.5 text-[10px] font-semibold leading-5 text-[#f4eee8]"
      >
        {cartItemCount}
      </span>
    );
  };

  return (
    <header className="border-b border-[#d8cec6] bg-[#f2ede7]">
      <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <Link
            href="/"
            className="flex items-center gap-3"
            onClick={() => {
              setIsMobileMenuOpen(false);
              setIsAboutOpen(false);
            }}
          >
            <Image
              src="/images/logo.png"
              alt="Yoga Pilates Fitness Studio logo"
              width={56}
              height={56}
              className="h-36 w-36 rounded-full object-cover"
              priority
            />
            <div className="flex flex-col">
              <span className="text-lg font-medium tracking-wide text-[#6f2b2b] sm:text-2xl">{siteConfig.brandName}</span>
              <span className="text-xs tracking-wide text-[#8a5959] sm:text-sm">Brussels Yoga, Pilates & Fitness</span>
            </div>
          </Link>

          <button
            type="button"
            aria-label="Toggle navigation menu"
            aria-expanded={isMobileMenuOpen}
            className="inline-flex items-center justify-center rounded-md border border-[#c7b7aa] px-3 py-2 text-sm text-[#7b2d2d] md:hidden"
            onClick={() => {
              setIsMobileMenuOpen((prev) => !prev);
              setIsAboutOpen(false);
            }}
          >
            Menu
          </button>
        </div>

        <div className="mt-4 hidden items-center justify-between gap-4 md:flex">
          <nav className="flex items-center justify-center gap-4">
            {primaryItems.map((item, index) => {
              if (item.type === "disclosure") {
                return (
                  <div key={item.id} className="relative flex items-center gap-4" ref={desktopAboutRef}>
                    <button
                      type="button"
                      aria-expanded={isDesktopAboutOpen}
                      aria-haspopup="menu"
                      aria-controls="about-us-menu-desktop"
                      className={`${linkClass(item.links.some((link) => isActivePath(pathname, link.href)))} inline-flex items-center gap-1`}
                      onClick={() => setIsDesktopAboutOpen((prev) => !prev)}
                    >
                      {item.label}
                      <span aria-hidden="true" className={`transition-transform ${isDesktopAboutOpen ? "rotate-180" : ""}`}>
                        v
                      </span>
                    </button>

                    <div
                      id="about-us-menu-desktop"
                      role="menu"
                      hidden={!isDesktopAboutOpen}
                      aria-hidden={!isDesktopAboutOpen}
                      className={`${
                        isDesktopAboutOpen ? "block" : "hidden"
                      } absolute left-0 top-full z-20 mt-2 min-w-[280px] rounded-md border border-[#d8cec6] bg-[#fffdfa] p-2 shadow-md`}
                    >
                      {item.links.map((link) => (
                        <Link
                          key={link.href}
                          href={link.href}
                          role="menuitem"
                          className={`block whitespace-nowrap rounded px-2 py-1.5 text-sm ${linkClass(isActivePath(pathname, link.href))}`}
                          onClick={() => setIsDesktopAboutOpen(false)}
                        >
                          {link.label}
                        </Link>
                      ))}
                    </div>

                    {index < primaryItems.length - 1 ? <span className="text-[#b68585]">|</span> : null}
                  </div>
                );
              }

              return (
                <div key={item.href} className="flex items-center gap-4">
                  <Link href={item.href} className={`${linkClass(isActivePath(pathname, item.href))} inline-flex items-center gap-2`}>
                    <span>{item.label}</span>
                    {renderCartBadge(item.href)}
                  </Link>
                  {index < primaryItems.length - 1 ? <span className="text-[#b68585]">|</span> : null}
                </div>
              );
            })}
          </nav>

          <nav className="flex items-center gap-3">
            {accountItems.map((item) => {
              if (item.type === "action") {
                return (
                  <form key={item.id} action={onSignOutAction}>
                    <button type="submit" className={linkClass(false)}>
                      {item.label}
                    </button>
                  </form>
                );
              }

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`${linkClass(isActivePath(pathname, item.href))} inline-flex items-center gap-2`}
                >
                  <span>{item.label}</span>
                  {renderCartBadge(item.href)}
                </Link>
              );
            })}
          </nav>
        </div>

        {isMobileMenuOpen ? (
          <div data-testid="mobile-nav-panel" className="mt-4 border-t border-[#d8cec6] pt-3 md:hidden">
            <nav className="flex flex-col gap-2">
              {primaryItems.map((item) => {
                if (item.type === "disclosure") {
                  return (
                    <section key={item.id} className="w-full">
                      <button
                        type="button"
                        data-testid="mobile-about-toggle"
                        aria-expanded={isAboutOpen}
                        aria-controls="about-mobile-links"
                        className="inline-flex items-center gap-1 text-sm tracking-wide text-[#8a5959] hover:text-[#7b2d2d]"
                        onClick={() => setIsAboutOpen((prev) => !prev)}
                      >
                        {item.label}
                        <span aria-hidden="true" className={`transition-transform ${isAboutOpen ? "rotate-180" : ""}`}>
                          v
                        </span>
                      </button>

                      <div
                        id="about-mobile-links"
                        hidden={!isAboutOpen}
                        className={`${isAboutOpen ? "block" : "hidden"} mt-2 space-y-2 border-l border-[#d8cec6] pl-3`}
                      >
                        {item.links.map((link) => (
                          <Link
                            key={link.href}
                            href={link.href}
                            data-testid={`mobile-about-link-${link.href.replace(/\//g, "-")}`}
                            className={`block whitespace-nowrap text-sm ${linkClass(isActivePath(pathname, link.href))}`}
                            onClick={() => setIsMobileMenuOpen(false)}
                          >
                            {link.label}
                          </Link>
                        ))}
                      </div>
                    </section>
                  );
                }

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`${linkClass(isActivePath(pathname, item.href))} inline-flex items-center gap-2`}
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    <span>{item.label}</span>
                    {renderCartBadge(item.href)}
                  </Link>
                );
              })}
            </nav>

            <nav className="mt-3 flex flex-col gap-2 border-t border-[#d8cec6] pt-3">
              {accountItems.map((item) => {
                if (item.type === "action") {
                  return (
                    <form key={item.id} action={onSignOutAction}>
                      <button type="submit" className={`${linkClass(false)} text-left`}>
                        {item.label}
                      </button>
                    </form>
                  );
                }

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`${linkClass(isActivePath(pathname, item.href))} inline-flex items-center gap-2`}
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    <span>{item.label}</span>
                    {renderCartBadge(item.href)}
                  </Link>
                );
              })}
            </nav>
          </div>
        ) : null}
      </div>
    </header>
  );
}
