import Link from "next/link";
import { redirect } from "next/navigation";

import AdminPagination from "@/components/admin/AdminPagination";
import { replayAutomationDeadLetterAction, sendAutomationTemplateTestEmailAction } from "@/app/admin/(private)/automations/actions";
import { getAutomationAuditLogPage, getAutomationDeadLetterPage, getAutomationScaffoldRows, getAutomationTemplateDetail } from "@/lib/email/email-automation-admin-service";

type Params = Promise<{ templateKey: string }>;
type SearchParams = Promise<{ deadLetterPage?: string | string[]; auditPage?: string | string[]; testSuccess?: string; testError?: string; testEmail?: string }>;

function parsePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(raw ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export default async function AdminAutomationDetailPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { templateKey } = await params;
  const sp = await searchParams;
  const deadLetterPage = parsePage(sp.deadLetterPage);
  const auditPage = parsePage(sp.auditPage);

  const [detail, rows, deadLetters, auditLog] = await Promise.all([
    getAutomationTemplateDetail(templateKey),
    getAutomationScaffoldRows(),
    getAutomationDeadLetterPage(templateKey, deadLetterPage, 20),
    getAutomationAuditLogPage(templateKey, auditPage, 20),
  ]);
  const row = rows.find((item) => item.templateKey === templateKey);
  if (!row) redirect("/admin/automations");
  const status = detail ? (detail.isActive ? "Active" : "Paused") : "Draft";

  return (
    <section className="space-y-4">
      <Link href="/admin/automations" className="text-sm text-[#2a4f78] underline">Back to Automations</Link>
      <header className="rounded border border-[#d3dbe5] bg-white p-4">
        <p className="text-xs uppercase tracking-wide text-[#5a6d86]">Trigger event</p>
        <h1 className="text-4xl font-semibold text-[#1f2735]">{row.triggerLabel}</h1>
        <p className="mt-2 text-sm text-[#4b5a72]">{row.whenDescription}</p>
        <p className="mt-2 text-sm">{status}</p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded border border-[#d3dbe5] bg-white p-4"><p className="text-xs uppercase tracking-wide text-[#5a6d86]">Sends - Last 30 Days</p><p className="mt-1 text-4xl font-semibold">{row.sentLast30Days}</p></article>
        <article className="rounded border border-[#d3dbe5] bg-white p-4"><p className="text-xs uppercase tracking-wide text-[#5a6d86]">Open Rate</p><p className="mt-1 text-4xl font-semibold">{row.openRate ?? 0}%</p></article>
        <article className="rounded border border-[#d3dbe5] bg-white p-4"><p className="text-xs uppercase tracking-wide text-[#5a6d86]">Click Rate</p><p className="mt-1 text-4xl font-semibold">{row.clickRate ?? 0}%</p></article>
        <article className="rounded border border-[#d3dbe5] bg-white p-4"><p className="text-xs uppercase tracking-wide text-[#5a6d86]">Unsubscribes</p><p className="mt-1 text-4xl font-semibold">{row.unsubscribeRate ?? 0}%</p></article>
      </section>

      <section className="rounded border border-[#d3dbe5] bg-white">
        <h2 className="border-b border-[#d3dbe5] px-4 py-3 font-semibold">When it sends</h2>
        <dl className="grid grid-cols-[160px_1fr] gap-y-2 px-4 py-3 text-sm">
          <dt className="text-[#5a6d86]">Trigger</dt><dd>{row.triggerLabel}</dd>
          <dt className="text-[#5a6d86]">Delay</dt><dd>{row.whenDescription}</dd>
          <dt className="text-[#5a6d86]">Audience</dt><dd>{row.category === "Auth" ? "Authenticated users" : "Eligible recipients"}</dd>
          <dt className="text-[#5a6d86]">Send window</dt><dd>Anytime</dd>
        </dl>
      </section>

      <section className="rounded border border-[#d3dbe5] bg-white">
        <h2 className="border-b border-[#d3dbe5] px-4 py-3 font-semibold">Email content</h2>
        <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
          <div>
            <p className="text-xs uppercase tracking-wide text-[#5a6d86]">Subject</p>
            <p>{detail?.subjectTemplate ?? "Not configured"}</p>
            <p className="mt-2 text-xs uppercase tracking-wide text-[#5a6d86]">Preview text</p>
            <p>{row.previewText || "Not set yet."}</p>
          </div>
          <Link href={`/admin/automations/${templateKey}/edit`} className="rounded bg-[#1d3652] px-4 py-2 text-white">{detail ? "Edit template" : "Configure template"}</Link>
        </div>
      </section>

      <section className="rounded border border-[#d3dbe5] bg-white">
        <h2 className="border-b border-[#d3dbe5] px-4 py-3 font-semibold">A/B test</h2>
        <div className="flex items-center justify-between px-4 py-3 text-sm">
          <p>No A/B test running. Add a variant to test alternative subject lines or content.</p>
          <button type="button" disabled className="rounded border border-[#d3dbe5] px-4 py-2 disabled:opacity-60">Add variant</button>
        </div>
      </section>

      {detail ? (
      <section className="rounded border border-[#d3dbe5] bg-white p-4">
        <h2 className="font-semibold">Preview & Test</h2>
        <form action={sendAutomationTemplateTestEmailAction} className="mt-3 flex items-end gap-3">
          <input type="hidden" name="templateKey" value={templateKey} />
          <label className="flex-1 text-sm">Recipient email<input name="toEmail" type="email" defaultValue={sp.testEmail ?? ""} className="mt-1 w-full rounded border border-[#d3dbe5] px-3 py-2" required /></label>
          <button type="submit" className="rounded bg-[#1d3652] px-4 py-2 text-white">Send test</button>
        </form>
        {sp.testSuccess === "1" ? <p className="mt-2 text-sm text-[#166534]">Test email sent.</p> : null}
        {sp.testError === "1" ? <p className="mt-2 text-sm text-[#7b2d2d]">Test email failed.</p> : null}
      </section>
      ) : null}

      {detail ? (
      <section className="space-y-2 rounded border border-[#d3dbe5] bg-white p-4">
        <h2 className="font-semibold">Dead-letter visibility</h2>
        {deadLetters.items.length === 0 ? <p className="text-sm text-[#4b5a72]">No dead-letter events.</p> : (
          <table className="w-full text-sm"><thead><tr><th className="text-left">Recipient</th><th className="text-left">Attempts</th><th className="text-left">Last error</th><th /></tr></thead><tbody>
            {deadLetters.items.map((item) => <tr key={item.id}><td>{item.recipientEmail}</td><td>{item.attempts}/{item.maxAttempts}</td><td>{item.lastError ?? "-"}</td><td><form action={replayAutomationDeadLetterAction}><input type="hidden" name="eventId" value={item.id} /><input type="hidden" name="templateKey" value={templateKey} /><button className="underline">Replay</button></form></td></tr>)}
          </tbody></table>
        )}
        <AdminPagination page={deadLetters.page} totalPages={deadLetters.totalPages} onChange={(page) => `/admin/automations/${templateKey}?deadLetterPage=${page}`} />
      </section>
      ) : null}

      {detail ? (
      <section className="space-y-2 rounded border border-[#d3dbe5] bg-white p-4">
        <h2 className="font-semibold">Audit trail</h2>
        {auditLog.items.length === 0 ? <p className="text-sm text-[#4b5a72]">No audit log entries.</p> : (
          <table className="w-full text-sm"><thead><tr><th className="text-left">Action</th><th className="text-left">Actor</th><th className="text-left">Date</th></tr></thead><tbody>
            {auditLog.items.map((entry) => <tr key={entry.id}><td>{entry.action}</td><td>{entry.actorEmail ?? entry.actorName ?? "-"}</td><td>{entry.createdAt.toISOString()}</td></tr>)}
          </tbody></table>
        )}
        <AdminPagination page={auditLog.page} totalPages={auditLog.totalPages} onChange={(page) => `/admin/automations/${templateKey}?auditPage=${page}`} />
      </section>
      ) : null}
    </section>
  );
}
