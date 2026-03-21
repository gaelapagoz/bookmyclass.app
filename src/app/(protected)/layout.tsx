import { requireAuth } from "@/lib/auth/require-auth";
import Footer from "@/components/Footer";
import Navbar from "@/components/Navbar";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAuth();

  return (
    <div className="flex min-h-full flex-col bg-[#f7f3ee] text-[#4f2a2a]">
      <Navbar />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
