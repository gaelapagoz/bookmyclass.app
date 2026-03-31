import Link from "next/link";

type CampaignRow = {
  id: string;
  name: string;
  categoryName: string;
  status: string;
  audience: string;
  updatedAt: string;
  sentAt: string | null;
  openRate: number;
  clickRate: number;
};

type Props = {
  rows: CampaignRow[];
  activeFilter: "all" | "draft" | "sent";
};

export default function MarketingCampaignTable({ rows, activeFilter }: Props) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <Link href="/admin/marketing/campaigns" className={`rounded-md border px-3 py-1.5 ${activeFilter === "all" ? "bg-[#1d3652] text-white border-[#1d3652]" : "border-[#d3dbe5]"}`}>
          All
        </Link>
        <Link href="/admin/marketing/campaigns?status=draft" className={`rounded-md border px-3 py-1.5 ${activeFilter === "draft" ? "bg-[#1d3652] text-white border-[#1d3652]" : "border-[#d3dbe5]"}`}>
          Drafts
        </Link>
        <Link href="/admin/marketing/campaigns?status=sent" className={`rounded-md border px-3 py-1.5 ${activeFilter === "sent" ? "bg-[#1d3652] text-white border-[#1d3652]" : "border-[#d3dbe5]"}`}>
          Sent
        </Link>
        <Link href="/admin/marketing/campaigns/new" className="ml-auto rounded-md bg-[#1d3652] px-3 py-1.5 text-white">
          Create campaign
        </Link>
      </div>

      {rows.length < 1 ? (
        <div className="rounded-xl border border-[#d3dbe5] bg-white p-5 text-sm text-[#4b5a72]">No campaigns found.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#d3dbe5] bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-[#f3f6fb] text-left text-xs uppercase tracking-wide text-[#5a6d86]">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Audience</th>
                <th className="px-3 py-2">Updated</th>
                <th className="px-3 py-2">Sent</th>
                <th className="px-3 py-2">Open rate</th>
                <th className="px-3 py-2">Click rate</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-[#e2e8f0] text-[#334155]">
                  <td className="px-3 py-2 font-medium">{row.name}</td>
                  <td className="px-3 py-2">{row.categoryName}</td>
                  <td className="px-3 py-2">{row.status}</td>
                  <td className="px-3 py-2">{row.audience}</td>
                  <td className="px-3 py-2">{row.updatedAt}</td>
                  <td className="px-3 py-2">{row.sentAt ?? "-"}</td>
                  <td className="px-3 py-2">{row.openRate}%</td>
                  <td className="px-3 py-2">{row.clickRate}%</td>
                  <td className="px-3 py-2">
                    <Link href={`/admin/marketing/campaigns/${row.id}/edit`} className="text-[#2a4f78] underline underline-offset-4">Open</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
