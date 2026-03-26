"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/bookings", label: "My Bookings" },
  { href: "/dashboard/membership", label: "My Memberships / Plans" },
  { href: "/dashboard/profile", label: "My Profile" },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/dashboard"
    ? pathname === "/dashboard"
    : pathname === href || pathname.startsWith(`${href}/`);
}

export function DashboardNav() {
  const pathname = usePathname();

  return (
    <nav className="rounded-xl border border-[#d8cec6] bg-white p-3">
      <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-[#8a5959]">
        Dashboard
      </p>
      <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-1">
        {links.map((link) => {
          const active = isActive(pathname, link.href);
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                className={`block rounded-md px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-[#7b2d2d] text-[#f4eee8]"
                    : "text-[#7b2d2d] hover:bg-[#f2ede7]"
                }`}
                aria-current={active ? "page" : undefined}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
