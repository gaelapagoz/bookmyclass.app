type CampaignPreviewProps = {
  fromName?: string;
  subject?: string;
  previewText?: string;
  htmlSnapshot?: string;
};

export default function CampaignPreview({
  fromName = "Studio Team",
  subject = "Your spring reset starts now",
  previewText = "We prepared a gentle campaign draft to help your members discover upcoming classes and new offers.",
  htmlSnapshot,
}: CampaignPreviewProps) {
  return (
    <section className="h-full rounded-xl border border-[#d3dbe5] bg-[#f8fbff] p-4">
      <h2 className="text-base font-semibold text-[#1f2735]">Live Preview</h2>
      <div className="mt-3 h-[calc(100%-2.5rem)] min-h-[520px] w-full overflow-y-auto rounded-lg border border-[#d3dbe5] bg-white p-6">
        <p className="text-xs uppercase tracking-wide text-[#5a6d86]">{fromName}</p>
        <h3 className="mt-2 text-2xl font-semibold text-[#1f2735]">{subject}</h3>
        <p className="mt-2 text-sm text-[#4b5a72]">{previewText}</p>
        {htmlSnapshot ? (
          <div className="mt-4 rounded-md border border-[#e2e8f0] bg-white p-4 text-sm text-[#334155]" dangerouslySetInnerHTML={{ __html: htmlSnapshot }} />
        ) : (
          <p className="mt-3 text-sm leading-6 text-[#334155]">
            Hi there,
            <br />
            <br />
            We prepared a gentle campaign draft to help your members discover upcoming classes and new offers.
          </p>
        )}
        <p className="mt-8 text-xs text-[#64748b]">This is placeholder content for the campaign email canvas.</p>
      </div>
    </section>
  );
}
