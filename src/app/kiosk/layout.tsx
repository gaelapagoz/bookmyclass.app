import Link from "next/link";
import { requireStaffSession } from "@/lib/auth/require-auth";

export default async function KioskLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Kiosk can be accessed by teaching and admin staff.
  await requireStaffSession({
    callbackUrl: "/kiosk",
    unauthorizedPath: "/sign-in",
  });

  return (
    <div className="min-h-screen bg-[#f7f3ee] text-[#4f2a2a]">
      <header className="border-b border-[#d8cec6] bg-white px-6 py-4 shadow-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-[#1f2735]">Kiosk Check-In</h1>
            <p className="mt-1 text-sm text-[#4b5a72]">Select a session to begin check-in</p>
          </div>
          <Link
            href="/kiosk/exit"
            className="rounded-md bg-[#7b2d2d] px-4 py-2 text-sm text-[#f4eee8] transition-opacity hover:opacity-90"
          >
            Exit Kiosk
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
