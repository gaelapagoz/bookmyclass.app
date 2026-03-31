type AdminPlaceholderPageProps = {
  title: string;
  description?: string;
};

export default function AdminPlaceholderPage({ title, description }: AdminPlaceholderPageProps) {
  return (
    <section className="space-y-3 rounded-xl border border-[#d3dbe5] bg-white p-6">
      <h1 className="text-2xl font-semibold text-[#1f2735]">{title}</h1>
      <p className="text-sm text-[#4b5a72]">
        {description ?? "This section is planned for a later beta phase and will be enabled soon."}
      </p>
    </section>
  );
}
