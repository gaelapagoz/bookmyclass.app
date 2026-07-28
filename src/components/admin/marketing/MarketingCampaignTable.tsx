import Link from "next/link";
import { MarketingCampaignStatus } from "@prisma/client";

type CampaignRow = {
  id: string;
  name: string;
  categoryName: string;
  status: MarketingCampaignStatus;
  updatedAt: string;
  sentAt: string | null;
  recipientCount: number;
};

type Props = {
  rows: CampaignRow[];
};

function toStatusLabel(status: MarketingCampaignStatus): string {
  return status === MarketingCampaignStatus.SENT ? "SENT" : "DRAFT";
}

function getActionHref(row: CampaignRow): string {
  if (row.status === MarketingCampaignStatus.SENT) {
    return `/admin/campaigns/${row.id}/summary`;
  }
  return `/admin/campaigns/new?campaignId=${row.id}`;
}

function getActionLabel(row: CampaignRow): string {
  return row.status === MarketingCampaignStatus.SENT ? "Summary" : "Continue";
}

export default function MarketingCampaignTable({ rows }: Props) {
  return (
    <section className="space-y-3">
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
                <th className="px-3 py-2">Sent</th>
                <th className="px-3 py-2">Recipients</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-[#e2e8f0] text-[#334155]">
                  <td className="px-3 py-2 font-medium">{row.name}</td>
                  <td className="px-3 py-2">{row.categoryName}</td>
                  <td className="px-3 py-2">{toStatusLabel(row.status)}</td>
                  <td className="px-3 py-2">{row.sentAt ?? "-"}</td>
                  <td className="px-3 py-2">{row.recipientCount}</td>
                  <td className="px-3 py-2">
                    <Link href={getActionHref(row)} className="text-[#2a4f78] underline underline-offset-4">
                      {getActionLabel(row)}
                    </Link>
                    <span className="ml-2 text-xs text-[#5a6d86]">{row.updatedAt}</span>
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
