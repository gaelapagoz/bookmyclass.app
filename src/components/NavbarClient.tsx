"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { siteConfig } from "@/lib/site-config";
import {
  getHeaderAccountNavigation,
  getHeaderPrimaryNavigation,
  type HeaderAccountNavItem,
  type HeaderNavDisclosure,
  type HeaderPrimaryNavItem,
} from "@/lib/navigation/site-header-nav";

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
  item: HeaderNavDisclosure;
  menuId: string;
  onClose: () => void;
  onToggle: () => void;
  onNavigateLink: (href: string) => void;
};

function AboutDisclosure({ isOpen, isVertical, item, menuId, onClose, onToggle, onNavigateLink }: AboutDisclosureProps) {
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

  const hasActiveChild = item.links.some((link) => isActivePath(pathname, link.href));

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
        {item.label}
        <span aria-hidden="true" className={`transition-transform ${isOpen ? "rotate-180" : ""}`}>
          v
        </span>
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
        {item.links.map((link) =>
          isVertical ? (
            <button
              key={link.href}
              type="button"
              role="menuitem"
              className={`block w-full whitespace-nowrap rounded px-2 py-1.5 text-left text-sm ${linkClass(
                isActivePath(pathname, link.href),
              )}`}
              onClick={() => onNavigateLink(link.href)}
            >
              {link.label}
            </button>
          ) : (
            <Link
              key={link.href}
              href={link.href}
              role="menuitem"
              className={`block whitespace-nowrap rounded px-2 py-1.5 text-sm ${linkClass(isActivePath(pathname, link.href))}`}
              onClick={() => onNavigateLink(link.href)}
            >
              {link.label}
            </Link>
          ),
        )}
      </div>
    </div>
  );
}

type PublicNavProps = {
  isAboutOpen: boolean;
  isVertical: boolean;
  items: HeaderPrimaryNavItem[];
  menuId: string;
  onCloseAll: () => void;
  onNavigateLink: (href: string) => void;
  onToggleAbout: () => void;
};

function PublicNavigation({
  isAboutOpen,
  isVertical,
  items,
  menuId,
  onCloseAll,
  onNavigateLink,
  onToggleAbout,
}: PublicNavProps) {
  const pathname = usePathname();

  return (
    <nav className={`${isVertical ? "flex flex-col gap-2" : "flex items-center justify-center gap-4"}`}>
      {items.map((item, index) => {
        if (item.type === "disclosure") {
          return (
            <div key={item.id} className={isVertical ? "" : "flex items-center gap-4"}>
              <AboutDisclosure
                isOpen={isAboutOpen}
                isVertical={isVertical}
                item={item}
                menuId={menuId}
                onClose={onCloseAll}
                onToggle={onToggleAbout}
                onNavigateLink={onNavigateLink}
              />
              {!isVertical && index < items.length - 1 ? <span className="text-[#b68585]">|</span> : null}
            </div>
          );
        }

        return (
          <div key={item.href} className={isVertical ? "" : "flex items-center gap-4"}>
            {isVertical ? (
              <button
                type="button"
                className={`${linkClass(isActivePath(pathname, item.href))} text-left`}
                onClick={() => onNavigateLink(item.href)}
              >
                {item.label}
              </button>
            ) : (
              <Link
                href={item.href}
                className={linkClass(isActivePath(pathname, item.href))}
                onClick={() => onNavigateLink(item.href)}
              >
                {item.label}
              </Link>
            )}
            {!isVertical && index < items.length - 1 ? <span className="text-[#b68585]">|</span> : null}
          </div>
        );
      })}
    </nav>
  );
}

type AccountNavProps = {
  isVertical: boolean;
  items: HeaderAccountNavItem[];
  onNavigateLink: (href: string) => void;
  onSignOutAction: (formData: FormData) => Promise<void>;
};

function AccountNavigation({ isVertical, items, onNavigateLink, onSignOutAction }: AccountNavProps) {
  const pathname = usePathname();

  return (
    <nav className={`flex ${isVertical ? "flex-col gap-2" : "items-center gap-3"}`}>
      {items.map((item) => {
        if (item.type === "action") {
          return (
            <form key={item.id} action={onSignOutAction}>
              <button type="submit" className={`${linkClass(false)} ${isVertical ? "text-left" : ""}`}>
                {item.label}
              </button>
            </form>
          );
        }

        return isVertical ? (
          <button
            key={item.href}
            type="button"
            className={`${linkClass(isActivePath(pathname, item.href))} text-left`}
            onClick={() => onNavigateLink(item.href)}
          >
            {item.label}
          </button>
        ) : (
          <Link
            key={item.href}
            href={item.href}
            className={linkClass(isActivePath(pathname, item.href))}
            onClick={() => onNavigateLink(item.href)}
          >
            {item.label}
          </Link>
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
  const router = useRouter();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isAboutMenuOpen, setIsAboutMenuOpen] = useState(false);

  const primaryItems = useMemo(() => getHeaderPrimaryNavigation(), []);
  const accountItems = useMemo(
    () => getHeaderAccountNavigation({ isAuthenticated }),
    [isAuthenticated],
  );

  useEffect(() => {
    setIsMobileMenuOpen(false);
    setIsAboutMenuOpen(false);
  }, [pathname, isAuthenticated]);

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

  const navigateDesktop = (href: string) => {
    void href;
    closeMenus();
  };

  const navigateMobile = (href: string) => {
    router.push(href);
    closeAllNavigation();
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
              <span className="text-lg font-medium tracking-wide text-[#6f2b2b] sm:text-2xl">{siteConfig.brandName}</span>
              <span className="text-xs tracking-wide text-[#8a5959] sm:text-sm">Brussels Yoga, Pilates & Fitness</span>
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
            isAboutOpen={isAboutMenuOpen}
            isVertical={false}
            items={primaryItems}
            menuId="about-us-menu-desktop"
            onCloseAll={closeMenus}
            onNavigateLink={navigateDesktop}
            onToggleAbout={toggleAboutMenu}
          />

          <AccountNavigation
            isVertical={false}
            items={accountItems}
            onNavigateLink={navigateDesktop}
            onSignOutAction={onSignOutAction}
          />
        </div>

        {isMobileMenuOpen ? (
          <nav className="mt-4 flex flex-col gap-2 border-t border-[#d8cec6] pt-3 md:hidden">
            <PublicNavigation
              isAboutOpen={isAboutMenuOpen}
              isVertical={true}
              items={primaryItems}
              menuId="about-us-menu-mobile"
              onCloseAll={closeAllNavigation}
              onNavigateLink={navigateMobile}
              onToggleAbout={toggleAboutMenu}
            />

            <AccountNavigation
              isVertical={true}
              items={accountItems}
              onNavigateLink={navigateMobile}
              onSignOutAction={onSignOutAction}
            />
          </nav>
        ) : null}
      </div>
    </header>
  );
}
