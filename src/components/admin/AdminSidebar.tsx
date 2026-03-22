"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const adminNavItems = [
  { href: "/admin/dashboard", label: "Dashboard" },
  { href: "/admin/classes", label: "Classes" },
  { href: "/admin/sessions", label: "Sessions" },
  { href: "/admin/plans", label: "Plans" },
  { href: "/admin/bookings", label: "Bookings" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/subscriptions", label: "Subscriptions" },
  { href: "/admin/learning-programs", label: "Learning Programs" },
  { href: "/admin/learning-videos", label: "Learning Videos" },
] as const;

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-full border-r border-[#223046] bg-[#0f1f31] text-[#f4eee8] md:w-64">
      <div className="border-b border-[#223046] px-5 py-5">
        <p className="text-xs uppercase tracking-[0.2em] text-[#d9c8be]">Yoga Pilates Fitness Studio</p>
        <h2 className="mt-1 text-lg font-semibold">Admin</h2>
      </div>

      <nav className="p-3">
        <ul className="space-y-1">
          {adminNavItems.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`block rounded-md px-3 py-2 text-sm transition-colors ${
                    active
                      ? "bg-[#1d3652] text-[#f4eee8]"
                      : "text-[#d9c8be] hover:bg-[#1b2f47] hover:text-[#f4eee8]"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
