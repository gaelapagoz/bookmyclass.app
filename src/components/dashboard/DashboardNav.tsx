"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/profile", label: "My Profile" },
  { href: "/dashboard/bookings", label: "My Bookings" },
  { href: "/dashboard/membership", label: "Membership / Plans" },
  { href: "/dashboard/loyalty", label: "Loyalty" },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/dashboard"
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

export function DashboardNav() {
  const pathname = usePathname();

  return (
    <nav className="mb-6 flex flex-wrap gap-2">
      {links.map((link) => {
        const active = isActive(pathname, link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`rounded-md border px-3 py-2 text-sm transition-colors ${
              active
                ? "border-[#7b2d2d] bg-[#7b2d2d] text-[#f4eee8]"
                : "border-[#d8cec6] bg-white text-[#7b2d2d] hover:bg-[#f2ede7]"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
