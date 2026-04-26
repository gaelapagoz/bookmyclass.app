import { redirect } from "next/navigation";

import { requireAuth } from "@/lib/auth/require-auth";
import Footer from "@/components/Footer";
import Navbar from "@/components/Navbar";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireAuth();

  // Enforce that only CLIENT users can access protected (dashboard) routes
  if (session.user.role && session.user.role !== "CLIENT") {
    // Redirect staff users to appropriate area
    if (session.user.role === "TEACHER") {
      redirect("/teacher");
    }
    if (session.user.role === "ADMIN" || session.user.role === "MASTER_ADMIN") {
      redirect("/admin");
    }
  }

  return (
    <div className="flex min-h-full flex-col bg-[#f7f3ee] text-[#4f2a2a]">
      <Navbar />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
