import Link from "next/link";
import { siteConfig } from "@/lib/site-config";

type TeacherSidebarProps = {
  onSignOutAction?: (formData: FormData) => Promise<void>;
};

const teacherNavItems = [
  { href: "/teacher", label: "Dashboard" },
  { href: "/teacher/sessions", label: "My Schedule" },
  { href: "/teacher/profile", label: "My Profile" },
  { href: "/kiosk", label: "Check-in Kiosk", isKiosk: true },
] as const;

export default function TeacherSidebar({ onSignOutAction }: TeacherSidebarProps) {
  return (
    <aside className="w-full border-r border-[#223046] bg-[#13263a] text-[#f4eee8] md:w-64">
      <div className="border-b border-[#223046] px-5 py-5">
        <p className="text-xs uppercase tracking-[0.2em] text-[#d9c8be]">{siteConfig.brandName}</p>
        <h2 className="mt-1 text-lg font-semibold">Teacher Workspace</h2>
      </div>

      <nav className="p-3">
        <ul className="space-y-1">
          {teacherNavItems.map((item) => {
            const isKiosk = "isKiosk" in item && item.isKiosk;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`block rounded-md px-3 py-2 text-sm transition-colors ${
                    isKiosk
                      ? "border border-[#8a5959] bg-[#0f1f2d] text-[#f4eee8] hover:bg-[#1b2f47]"
                      : "text-[#d9c8be] hover:bg-[#1b2f47] hover:text-[#f4eee8]"
                  }`}
                  data-testid={isKiosk ? "teacher-nav-kiosk-item" : undefined}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
          {onSignOutAction ? (
            <li data-testid="teacher-nav-logout-item">
              <form action={onSignOutAction}>
                <button
                  type="submit"
                  className="w-full rounded-md px-3 py-2 text-left text-sm text-[#d9c8be] transition-colors hover:bg-[#1b2f47] hover:text-[#f4eee8]"
                >
                  Logout
                </button>
              </form>
            </li>
          ) : null}
        </ul>
      </nav>
    </aside>
  );
}
