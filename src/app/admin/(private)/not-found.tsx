function AdminPrivateNotFoundContent() {
  return (
    <section className="rounded-xl border border-[#d3dbe5] bg-white p-6">
      <h1 className="text-2xl font-semibold text-[#1f2735]">Admin page not found</h1>
      <p className="mt-2 text-sm text-[#4b5a72]">
        The admin route you requested does not exist.
      </p>
    </section>
  );
}

export default function AdminPrivateNotFoundPage() {
  return <AdminPrivateNotFoundContent />;
}
