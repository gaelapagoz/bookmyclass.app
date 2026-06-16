import Link from "next/link";

import { setAutomationTemplateStatusAction } from "@/app/admin/(private)/automations/actions";
import { getAutomationScaffoldRows } from "@/lib/email/email-automation-admin-service";

export default async function AdminAutomationsPage() {
  let rows = [] as Awaited<ReturnType<typeof getAutomationScaffoldRows>>;
  let loadError = false;
  try {
    rows = await getAutomationScaffoldRows();
  } catch (error) {
    loadError = true;
    console.error("[admin-automations] unable to load scaffold rows", error);
  }
  const total = rows.length;
  const active = rows.filter((row) => row.status === "Active").length;
  const drafts = rows.filter((row) => row.status === "Draft").length;
  const paused = rows.filter((row) => row.status === "Paused").length;
  const sent30 = rows.reduce((sum, row) => sum + row.sentLast30Days, 0);

  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold text-[#1f2735]">Automations</h1>
        <p className="mt-1 text-sm text-[#4b5a72]">Manage the email sent for each trigger event. One template per trigger.</p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          { label: "Total triggers", value: total },
          { label: "Active", value: active },
          { label: "Drafts", value: drafts },
          { label: "Paused", value: paused },
          { label: "Sent - 30D", value: sent30.toLocaleString("en-US") },
        ].map((item) => (
          <article key={item.label} className="rounded border border-[#d3dbe5] bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-[#5a6d86]">{item.label}</p>
            <p className="mt-1 text-3xl font-semibold text-[#1f2735]">{item.value}</p>
          </article>
        ))}
      </section>

      <section className="rounded border border-[#d3dbe5] bg-white">
        {loadError ? (
          <p className="border-b border-[#d3dbe5] px-3 py-2 text-sm text-[#7b2d2d]">Unable to load automations.</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 border-b border-[#d3dbe5] p-3">
          <input className="min-w-[220px] flex-1 rounded border border-[#d3dbe5] px-3 py-2 text-sm" placeholder="Search automations" />
          <button type="button" className="rounded bg-[#1d3652] px-3 py-2 text-sm text-white">Search</button>
          <button type="button" className="rounded bg-[#1d3652] px-3 py-2 text-sm text-white">Configure</button>
        </div>
        <div className="grid gap-3 border-b border-[#d3dbe5] p-3 md:grid-cols-2">
          <label className="text-xs uppercase tracking-wide text-[#5a6d86]">
            Status
            <select className="mt-1 w-full rounded border border-[#d3dbe5] px-2 py-2 text-sm">
              <option>All</option>
            </select>
          </label>
          <label className="text-xs uppercase tracking-wide text-[#5a6d86]">
            Category
            <select className="mt-1 w-full rounded border border-[#d3dbe5] px-2 py-2 text-sm">
              <option>All</option>
            </select>
          </label>
        </div>
        <div className="flex items-center gap-4 border-b border-[#d3dbe5] px-3 py-2 text-sm text-[#1f2735]">
          <button type="button">Set status</button>
          <button type="button">Add note</button>
          <button type="button">Remove note</button>
        </div>
        <div className="overflow-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr className="border-b border-[#d3dbe5] text-left text-xs uppercase tracking-wide text-[#5a6d86]">
                <th className="px-3 py-2">Sel</th>
                <th className="px-3 py-2">Trigger</th>
                <th className="px-3 py-2">Subject</th>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Sent - 30D</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Marketing</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e8edf3]">
              {rows.map((row) => (
                <tr key={row.templateKey}>
                  <td className="px-3 py-2"><input aria-label={`Select ${row.triggerLabel}`} type="checkbox" /></td>
                  <td className="px-3 py-2 font-medium">{row.triggerLabel}</td>
                  <td className="px-3 py-2">{row.subject}</td>
                  <td className="px-3 py-2">{row.whenDescription}</td>
                  <td className="px-3 py-2 tabular-nums">{row.sentLast30Days.toLocaleString("en-US")}</td>
                  <td className="px-3 py-2">{row.status}</td>
                  <td className="px-3 py-2">{row.marketingStatus}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Link href={`/admin/automations/${row.templateKey}`} className="text-[#2a4f78] underline">
                        {row.exists ? "View" : "Configure"}
                      </Link>
                      <form action={setAutomationTemplateStatusAction}>
                        <input type="hidden" name="templateKey" value={row.templateKey} />
                        <input type="hidden" name="status" value={row.status === "Active" ? "paused" : "active"} />
                        <button type="submit" className="rounded border border-[#d3dbe5] px-2 py-0.5 text-xs">
                          {row.status === "Active" ? "Pause" : "Activate"}
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
              {!loadError && rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-sm text-[#4b5a72]">No automations match these filters.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <footer className="flex items-center justify-between border-t border-[#d3dbe5] px-3 py-2 text-sm">
          <p>Page 1 of 1</p>
          <div className="flex items-center gap-2">
            <span>Previous</span>
            <span className="rounded bg-[#1d3652] px-2 py-0.5 text-white">1</span>
            <span>Next</span>
          </div>
        </footer>
      </section>
    </section>
  );
}
