"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { siteConfig } from "@/lib/site-config";

type NavLinkItem = {
  href: string;
  label: string;
  type: "link";
};

type NavDisclosureItem = {
  id: string;
  label: string;
  links: Array<{ href: string; label: string }>;
  type: "disclosure";
};

type PublicNavItem = NavLinkItem | NavDisclosureItem;

const publicNavItems: PublicNavItem[] = [
  { href: "/", label: "Home", type: "link" },
  { href: "/book-a-class", label: "Book a Class", type: "link" },
  { href: "/subscription", label: "Subscription", type: "link" },
  { href: "/learning", label: "Online Learning", type: "link" },
  {
    id: "about-us",
    label: "About Us",
    type: "disclosure",
    links: [
      { href: "/about/studio", label: "Our Studio" },
      { href: "/about/team", label: "Our Team" },
      { href: "/about/terms-and-conditions", label: "Terms and Conditions" },
      { href: "/about/faq", label: "FAQ" },
    ],
  },
];

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

type AboutDisclosureProps = {
  isOpen: boolean;
  isVertical: boolean;
  links: NavDisclosureItem["links"];
  menuId: string;
  onClose: () => void;
  onToggle: () => void;
};

function AboutDisclosure({ isOpen, isVertical, links, menuId, onClose, onToggle }: AboutDisclosureProps) {
  const pathname = usePathname();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    function handleOutside(event: MouseEvent | TouchEvent) {
      if (!isOpen || !wrapperRef.current) {
        return;
      }

      const target = event.target as Node | null;
      if (target && !wrapperRef.current.contains(target)) {
        onClose();
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && isOpen) {
        onClose();
        buttonRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, onClose]);

  const hasActiveChild = links.some((item) => isActivePath(pathname, item.href));

  return (
    <div ref={wrapperRef} className={`relative ${isVertical ? "w-full" : ""}`}>
      <button
        ref={buttonRef}
        type="button"
        className={`${linkClass(hasActiveChild)} inline-flex items-center gap-1`}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-controls={menuId}
        onClick={onToggle}
      >
        About Us
        <span aria-hidden="true" className={`transition-transform ${isOpen ? "rotate-180" : ""}`}>v</span>
      </button>

      <div
        id={menuId}
        role="menu"
        hidden={!isOpen}
        aria-hidden={!isOpen}
        className={`${
          isOpen ? "block" : "hidden"
        } ${isVertical ? "mt-2 space-y-2 border-l border-[#d8cec6] pl-3" : "absolute left-0 z-20 mt-2 min-w-[280px] rounded-md border border-[#d8cec6] bg-[#fffdfa] p-2 shadow-md"}`}
      >
        {links.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            role="menuitem"
            className={`block whitespace-nowrap rounded px-2 py-1.5 text-sm ${linkClass(isActivePath(pathname, item.href))}`}
            onClick={onClose}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

type PublicNavProps = {
  isOpen: boolean;
  isVertical: boolean;
  menuId: string;
  onCloseAll: () => void;
  onToggleAbout: () => void;
};

function PublicNavigation({ isOpen, isVertical, menuId, onCloseAll, onToggleAbout }: PublicNavProps) {
  const pathname = usePathname();

  return (
    <nav className={`${isVertical ? "flex flex-col gap-2" : "flex items-center justify-center gap-4"}`}>
      {publicNavItems.map((item, index) => {
        if (item.type === "disclosure") {
          return (
            <div key={item.id} className={isVertical ? "" : "flex items-center gap-4"}>
              <AboutDisclosure
                isOpen={isOpen}
                isVertical={isVertical}
                links={item.links}
                menuId={menuId}
                onClose={onCloseAll}
                onToggle={onToggleAbout}
              />
              {!isVertical && index < publicNavItems.length - 1 ? <span className="text-[#b68585]">|</span> : null}
            </div>
          );
        }

        return (
          <div key={item.href} className={isVertical ? "" : "flex items-center gap-4"}>
            <Link
              href={item.href}
              className={linkClass(isActivePath(pathname, item.href))}
              onClick={onCloseAll}
            >
              {item.label}
            </Link>
            {!isVertical && index < publicNavItems.length - 1 ? <span className="text-[#b68585]">|</span> : null}
          </div>
        );
      })}
    </nav>
  );
}

type NavbarClientProps = {
  isAuthenticated: boolean;
  onSignOutAction: (formData: FormData) => Promise<void>;
};

export default function NavbarClient({ isAuthenticated, onSignOutAction }: NavbarClientProps) {
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isAboutMenuOpen, setIsAboutMenuOpen] = useState(false);

  const authLinks = useMemo(
    () =>
      isAuthenticated
        ? [{ href: "/dashboard", label: "Dashboard" as const }]
        : [
            { href: "/sign-in", label: "Sign In" as const },
            { href: "/sign-up", label: "Sign Up" as const },
          ],
    [isAuthenticated],
  );

  useEffect(() => {
    setIsMobileMenuOpen(false);
    setIsAboutMenuOpen(false);
  }, [pathname]);

  const closeMenus = () => {
    setIsAboutMenuOpen(false);
  };

  const closeAllNavigation = () => {
    closeMenus();
    setIsMobileMenuOpen(false);
  };

  const toggleAboutMenu = () => {
    setIsAboutMenuOpen((prev) => !prev);
  };
  return (
    <header className="border-b border-[#d8cec6] bg-[#f2ede7]">
      <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-3" onClick={closeAllNavigation}>
            <Image
              src="/images/logo.png"
              alt="Yoga Pilates Fitness Studio logo"
              width={56}
              height={56}
              className="h-36 w-36 rounded-full object-cover"
              priority
            />
            <div className="flex flex-col">
              <span className="text-lg font-medium tracking-wide text-[#6f2b2b] sm:text-2xl">
                {siteConfig.brandName}
              </span>
              <span className="text-xs tracking-wide text-[#8a5959] sm:text-sm">
                Brussels Yoga, Pilates & Fitness
              </span>
            </div>
          </Link>

          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md border border-[#c7b7aa] px-3 py-2 text-sm text-[#7b2d2d] md:hidden"
            onClick={() => {
              setIsMobileMenuOpen((prev) => !prev);
              setIsAboutMenuOpen(false);
            }}
            aria-expanded={isMobileMenuOpen}
            aria-label="Toggle navigation menu"
          >
            Menu
          </button>
        </div>

        <div className="mt-4 hidden items-center justify-between gap-4 md:flex" hidden={isMobileMenuOpen}>
          <PublicNavigation
            isOpen={isAboutMenuOpen}
            isVertical={false}
            menuId="about-us-menu-desktop"
            onCloseAll={closeMenus}
            onToggleAbout={toggleAboutMenu}
          />

          <nav className="flex items-center gap-3">
            {authLinks.map((link) => (
              <Link key={link.href} href={link.href} className={linkClass(isActivePath(pathname, link.href))}>
                {link.label}
              </Link>
            ))}
            {isAuthenticated ? (
              <form action={onSignOutAction}>
                <button type="submit" className={linkClass(false)}>
                  Log Out
                </button>
              </form>
            ) : null}
          </nav>
        </div>

        {isMobileMenuOpen ? (
          <nav className="mt-4 flex flex-col gap-2 border-t border-[#d8cec6] pt-3 md:hidden">
            <PublicNavigation
              isOpen={isAboutMenuOpen}
              isVertical={true}
              menuId="about-us-menu-mobile"
              onCloseAll={closeAllNavigation}
              onToggleAbout={toggleAboutMenu}
            />

            {authLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={linkClass(isActivePath(pathname, link.href))}
                onClick={closeAllNavigation}
              >
                {link.label}
              </Link>
            ))}

            {isAuthenticated ? (
              <form action={onSignOutAction}>
                <button type="submit" className={`${linkClass(false)} text-left`} onClick={closeAllNavigation}>
                  Log Out
                </button>
              </form>
            ) : null}
          </nav>
        ) : null}
      </div>
    </header>
  );
}

