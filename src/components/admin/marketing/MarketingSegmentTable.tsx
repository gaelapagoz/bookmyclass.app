import { createMarketingSegmentAction, updateMarketingSegmentAction } from "@/app/admin/(private)/actions";

type SegmentRow = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  usageCount: number;
};

type Props = {
  rows: SegmentRow[];
};

export default function MarketingSegmentTable({ rows }: Props) {
  return (
    <section className="space-y-4">
      <form action={createMarketingSegmentAction} className="rounded-xl border border-[#d3dbe5] bg-white p-4">
        <h3 className="text-base font-semibold text-[#1f2735]">Create segment</h3>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-sm text-[#334155]">
            Name
            <input name="name" required className="mt-1 block rounded-md border border-[#d3dbe5] px-3 py-2" />
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-[#334155]">
            <input type="checkbox" name="isActive" defaultChecked /> Active
          </label>
          <button type="submit" className="rounded-md bg-[#1d3652] px-3 py-2 text-sm text-white">Create</button>
        </div>
      </form>

      <div className="overflow-x-auto rounded-xl border border-[#d3dbe5] bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-[#f3f6fb] text-left text-xs uppercase tracking-wide text-[#5a6d86]">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Slug</th>
              <th className="px-3 py-2">Users</th>
              <th className="px-3 py-2">Active</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-[#e2e8f0] text-[#334155]">
                <td className="px-3 py-2">{row.name}</td>
                <td className="px-3 py-2">{row.slug}</td>
                <td className="px-3 py-2">{row.usageCount}</td>
                <td className="px-3 py-2">{row.isActive ? "Yes" : "No"}</td>
                <td className="px-3 py-2">
                  <form action={updateMarketingSegmentAction} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={row.id} />
                    <input name="name" defaultValue={row.name} className="rounded-md border border-[#d3dbe5] px-2 py-1 text-sm" />
                    <label className="inline-flex items-center gap-1 text-xs">
                      <input type="checkbox" name="isActive" defaultChecked={row.isActive} /> active
                    </label>
                    <button type="submit" className="rounded border border-[#d3dbe5] px-2 py-1 text-xs">Save</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
