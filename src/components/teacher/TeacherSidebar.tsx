import Link from "next/link";

const teacherNavItems = [
  { href: "/teacher", label: "Dashboard" },
  { href: "/teacher/sessions", label: "Sessions" },
  { href: "/teacher/bookings", label: "Bookings" },
] as const;

export default function TeacherSidebar() {
  return (
    <aside className="w-full border-r border-[#223046] bg-[#13263a] text-[#f4eee8] md:w-64">
      <div className="border-b border-[#223046] px-5 py-5">
        <p className="text-xs uppercase tracking-[0.2em] text-[#d9c8be]">Yoga Pilates Fitness Studio</p>
        <h2 className="mt-1 text-lg font-semibold">Teacher</h2>
      </div>

      <nav className="p-3">
        <ul className="space-y-1">
          {teacherNavItems.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="block rounded-md px-3 py-2 text-sm text-[#d9c8be] transition-colors hover:bg-[#1b2f47] hover:text-[#f4eee8]"
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
