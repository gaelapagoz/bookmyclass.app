import Footer from "@/components/Footer";
import Navbar from "@/components/Navbar";

export default function PublicLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-full flex-col bg-[#f7f3ee] text-[#4f2a2a]">
      <Navbar />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
