type CampaignMetric = {
  id: string;
  name: string;
  sentAt: string | null;
  recipients: number;
  sent: number;
  opened: number;
  clicked: number;
  unsubscribed: number;
  openRate: number;
  clickRate: number;
};

type Props = {
  summary: {
    campaignsSent: number;
    recipients: number;
    sent: number;
    opened: number;
    clicked: number;
    unsubscribed: number;
    openRate: number;
    clickRate: number;
    byCampaign: CampaignMetric[];
  };
};

export default function MarketingAnalyticsSummary({ summary }: Props) {
  return (
    <section className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-xl border border-[#d3dbe5] bg-white p-4"><p className="text-xs uppercase tracking-wide text-[#5a6d86]">Campaigns sent</p><p className="mt-1 text-xl font-semibold text-[#1f2735]">{summary.campaignsSent}</p></article>
        <article className="rounded-xl border border-[#d3dbe5] bg-white p-4"><p className="text-xs uppercase tracking-wide text-[#5a6d86]">Recipients</p><p className="mt-1 text-xl font-semibold text-[#1f2735]">{summary.recipients}</p></article>
        <article className="rounded-xl border border-[#d3dbe5] bg-white p-4"><p className="text-xs uppercase tracking-wide text-[#5a6d86]">Open rate</p><p className="mt-1 text-xl font-semibold text-[#1f2735]">{summary.openRate}%</p></article>
        <article className="rounded-xl border border-[#d3dbe5] bg-white p-4"><p className="text-xs uppercase tracking-wide text-[#5a6d86]">Click rate</p><p className="mt-1 text-xl font-semibold text-[#1f2735]">{summary.clickRate}%</p></article>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[#d3dbe5] bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-[#f3f6fb] text-left text-xs uppercase tracking-wide text-[#5a6d86]">
            <tr>
              <th className="px-3 py-2">Campaign</th>
              <th className="px-3 py-2">Sent at</th>
              <th className="px-3 py-2">Recipients</th>
              <th className="px-3 py-2">Sent</th>
              <th className="px-3 py-2">Opened</th>
              <th className="px-3 py-2">Clicked</th>
              <th className="px-3 py-2">Unsubscribed</th>
              <th className="px-3 py-2">Open rate</th>
              <th className="px-3 py-2">Click rate</th>
            </tr>
          </thead>
          <tbody>
            {summary.byCampaign.map((row) => (
              <tr key={row.id} className="border-t border-[#e2e8f0] text-[#334155]">
                <td className="px-3 py-2 font-medium">{row.name}</td>
                <td className="px-3 py-2">{row.sentAt ?? "-"}</td>
                <td className="px-3 py-2">{row.recipients}</td>
                <td className="px-3 py-2">{row.sent}</td>
                <td className="px-3 py-2">{row.opened}</td>
                <td className="px-3 py-2">{row.clicked}</td>
                <td className="px-3 py-2">{row.unsubscribed}</td>
                <td className="px-3 py-2">{row.openRate}%</td>
                <td className="px-3 py-2">{row.clickRate}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
