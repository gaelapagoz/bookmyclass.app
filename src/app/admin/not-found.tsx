import AdminSidebar from "@/components/admin/AdminSidebar";

function AdminNotFoundContent() {
  return (
    <section className="rounded-xl border border-[#d3dbe5] bg-white p-6">
      <h1 className="text-2xl font-semibold text-[#1f2735]">Admin page not found</h1>
      <p className="mt-2 text-sm text-[#4b5a72]">
        The admin route you requested does not exist.
      </p>
    </section>
  );
}

export default function AdminNotFoundPage() {
  return (
    <div className="min-h-screen bg-[#e8edf3] text-[#1f2735] md:flex">
      <AdminSidebar />
      <main className="flex-1 p-5 md:p-8">
        <AdminNotFoundContent />
      </main>
    </div>
  );
}
