"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const publicNavLinks = [
  { href: "/", label: "Home" },
  { href: "/book-a-class", label: "Book a Class" },
  { href: "/subscription", label: "Subscription" },
  { href: "/learning", label: "Online Learning" },
] as const;

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

type NavbarClientProps = {
  isAuthenticated: boolean;
  onSignOutAction: (formData: FormData) => Promise<void>;
};

export default function NavbarClient({
  isAuthenticated,
  onSignOutAction,
}: NavbarClientProps) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  const authLinks = isAuthenticated
    ? [{ href: "/dashboard", label: "Dashboard" as const }]
    : [
        {
          href: "/sign-in",
          label: "Sign In" as const,
        },
        { href: "/sign-up", label: "Sign Up" as const },
      ];

  return (
    <header className="border-b border-[#d8cec6] bg-[#f2ede7]">
      <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-3" onClick={() => setIsOpen(false)}>
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
                Yoga Pilates Fitness Studio
              </span>
              <span className="text-xs tracking-wide text-[#8a5959] sm:text-sm">
                Brussels Yoga, Pilates & Fitness
              </span>
            </div>
          </Link>

          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md border border-[#c7b7aa] px-3 py-2 text-sm text-[#7b2d2d] md:hidden"
            onClick={() => setIsOpen((prev) => !prev)}
            aria-expanded={isOpen}
            aria-label="Toggle navigation menu"
          >
            Menu
          </button>
        </div>

        <div className="mt-4 hidden items-center justify-between gap-4 md:flex">
          <nav className="flex items-center justify-center gap-4">
            {publicNavLinks.map((link, index) => (
              <div key={link.href} className="flex items-center gap-4">
                <Link href={link.href} className={linkClass(isActivePath(pathname, link.href))}>
                  {link.label}
                </Link>
                {index < publicNavLinks.length - 1 ? <span className="text-[#b68585]">|</span> : null}
              </div>
            ))}
          </nav>

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

        {isOpen && (
          <nav className="mt-4 flex flex-col gap-2 border-t border-[#d8cec6] pt-3 md:hidden">
            {publicNavLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={linkClass(isActivePath(pathname, link.href))}
                onClick={() => setIsOpen(false)}
              >
                {link.label}
              </Link>
            ))}

            {authLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={linkClass(isActivePath(pathname, link.href))}
                onClick={() => setIsOpen(false)}
              >
                {link.label}
              </Link>
            ))}

            {isAuthenticated ? (
              <form action={onSignOutAction}>
                <button
                  type="submit"
                  className={`${linkClass(false)} text-left`}
                  onClick={() => setIsOpen(false)}
                >
                  Log Out
                </button>
              </form>
            ) : null}
          </nav>
        )}
      </div>
    </header>
  );
}

