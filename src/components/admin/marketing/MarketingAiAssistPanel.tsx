"use client";

type Props = {
  campaignId: string;
  action: (formData: FormData) => void | Promise<void>;
};

export default function MarketingAiAssistPanel({ campaignId, action }: Props) {
  return (
    <section className="rounded-xl border border-[#d3dbe5] bg-white p-4">
      <h3 className="text-base font-semibold text-[#1f2735]">AI Assist</h3>
      <p className="mt-1 text-sm text-[#4b5a72]">Generate subject, preview text, and content blocks from campaign intent.</p>
      <form action={action} className="mt-3 space-y-3">
        <input type="hidden" name="campaignId" value={campaignId} />
        <label className="block text-sm text-[#334155]">
          Campaign goal
          <input name="goal" required className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
        </label>
        <label className="block text-sm text-[#334155]">
          Audience
          <input name="audience" required className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm text-[#334155]">
            Tone
            <input name="tone" required className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
          </label>
          <label className="block text-sm text-[#334155]">
            CTA
            <input name="cta" required className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
          </label>
        </div>
        <label className="block text-sm text-[#334155]">
          Extra context (optional)
          <textarea name="extraContext" rows={3} className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
        </label>
        <button type="submit" className="rounded-md border border-[#1d3652] px-3 py-2 text-sm text-[#1d3652] hover:bg-[#f3f6fb]">
          Generate draft
        </button>
      </form>
    </section>
  );
}
