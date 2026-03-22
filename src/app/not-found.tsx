import NotFoundPage from "@/components/common/NotFoundPage";
import Footer from "@/components/Footer";
import Navbar from "@/components/Navbar";

export default function AppNotFound() {
  return (
    <div className="flex min-h-full flex-col bg-[#f7f3ee] text-[#4f2a2a]">
      <Navbar />
      <main className="flex-1">
        <NotFoundPage />
      </main>
      <Footer />
    </div>
  );
}
