import AdminLoyaltyManualGrantModal from "@/components/admin/AdminLoyaltyManualGrantModal";
import Link from "next/link";

import AdminPagination from "@/components/admin/AdminPagination";
import { requireAdminSession } from "@/lib/auth/require-auth";
import { getAdminLoyaltyOverview } from "@/lib/loyalty/loyalty-admin-service";

import { grantLoyaltyPointsAction } from "./actions";

type SearchParams = Promise<{
  clientId?: string | string[];
  currencyCode?: string | string[];
  error?: string | string[];
  page?: string | string[];
  q?: string | string[];
  success?: string | string[];
}>;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parsePage(value: string | string[] | undefined) {
  const parsed = Number(firstParam(value));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function formatDate(value: Date | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-BE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function formatPoints(points: number) {
  return new Intl.NumberFormat("en-BE").format(points);
}

function buildPageHref(input: {
  currencyCode: string;
  clientId?: string;
  page?: number;
  query?: string;
}) {
  const search = new URLSearchParams();
  search.set("currencyCode", input.currencyCode);

  if (input.clientId) {
    search.set("clientId", input.clientId);
  }

  if (input.page) {
    search.set("page", String(input.page));
  }

  if (input.query) {
    search.set("q", input.query);
  }

  return `/admin/sales/loyalty?${search.toString()}`;
}

function getEntryLabel(entryType: string) {
  switch (entryType) {
    case "EARN":
      return "Spend earning";
    case "MANUAL_GRANT":
      return "Manual grant";
    case "REVERSAL":
      return "Financial reversal";
    case "EXPIRE":
      return "Expiration";
    default:
      return entryType;
  }
}

export default async function AdminLoyaltySalesPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireAdminSession();
  const params = await searchParams;
  const currencyCode = firstParam(params.currencyCode)?.trim().toUpperCase();
  const query = firstParam(params.q)?.trim() ?? "";
  const page = parsePage(params.page);
  const clientId = firstParam(params.clientId)?.trim() || null;
  const error = firstParam(params.error)?.trim() ?? "";
  const success = firstParam(params.success)?.trim() ?? "";

  const data = await getAdminLoyaltyOverview({
    actorUserId: session.user.id,
    currencyCode,
    page,
    pageSize: 20,
    query,
    selectedClientId: clientId,
    historyLimit: 20,
  });

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[#1f2735]">Loyalty Activity</h1>
          <p className="mt-1 text-sm text-[#4b5a72]">
            Monitor client balances, point activity, expirations, and manual adjustments.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link href="/admin/loyalty" className="rounded-md border border-[#cbd5e1] bg-white px-3 py-2 text-sm font-medium text-[#1f2735]">
            Configure loyalty
          </Link>
          {data.programs.length > 0 ? data.programs.map((program) => (
            <Link
              key={program.id}
              href={buildPageHref({ currencyCode: program.currencyCode, clientId: clientId ?? undefined, query })}
              className={`rounded-md border px-3 py-2 text-sm font-medium ${
                program.currencyCode === data.currencyCode
                  ? "border-[#1d3652] bg-[#1d3652] text-white"
                  : "border-[#cbd5e1] bg-white text-[#1f2735]"
              }`}
            >
              {program.currencyCode}
            </Link>
          )) : null}
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-xl border border-[#d3dbe5] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-[#5a6d86]">Total number of clients</p>
          <p className="mt-2 text-2xl font-semibold text-[#1f2735]">{formatPoints(data.metrics.totalClients)}</p>
        </article>
        <article className="rounded-xl border border-[#d3dbe5] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-[#5a6d86]">Total points earned</p>
          <p className="mt-2 text-2xl font-semibold text-[#1f2735]">{formatPoints(data.metrics.totalEarnedPoints)}</p>
        </article>
        <article className="rounded-xl border border-[#d3dbe5] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-[#5a6d86]">Total manual grants</p>
          <p className="mt-2 text-2xl font-semibold text-[#1f2735]">{formatPoints(data.metrics.totalManualGrantPoints)}</p>
        </article>
        <article className="rounded-xl border border-[#d3dbe5] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-[#5a6d86]">Total points balance</p>
          <p className="mt-2 text-2xl font-semibold text-[#1f2735]">{formatPoints(data.metrics.totalBalancePoints)}</p>
        </article>
      </section>

      {error ? (
        <div className="rounded-xl border border-[#e5b3b3] bg-[#fff7f7] px-4 py-3 text-sm text-[#8a2d2d]">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="rounded-xl border border-[#bbd7c3] bg-[#f4fbf6] px-4 py-3 text-sm text-[#1f5a35]">
          {success}
        </div>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="space-y-5">
          <section className="rounded-xl border border-[#d3dbe5] bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-[#1f2735]">Client balances</h2>
                <p className="mt-1 text-sm text-[#4b5a72]">
                  Search existing loyalty clients or find a verified client for a manual grant.
                </p>
              </div>

              <form action="/admin/sales/loyalty" className="flex flex-wrap gap-2">
                <input type="hidden" name="currencyCode" value={data.currencyCode} />
                <input
                  name="q"
                  defaultValue={query}
                  placeholder="Search client name or email"
                  className="rounded-md border border-[#cbd5e1] bg-white px-3 py-2 text-sm md:min-w-72"
                />
                <button type="submit" className="rounded-md bg-[#1d3652] px-3 py-2 text-sm font-semibold text-white">
                  Search
                </button>
              </form>
            </div>

            {data.clients.items.length === 0 ? (
              <div className="mt-4 rounded-md border border-dashed border-[#cbd5e1] px-4 py-5 text-sm text-[#4b5a72]">
                No loyalty clients found for this filter.
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto rounded-xl border border-[#d3dbe5]">
                <table className="min-w-full text-sm">
                  <thead className="bg-[#f3f6fb] text-left text-xs uppercase tracking-wide text-[#5a6d86]">
                    <tr>
                      <th className="px-3 py-2">Client</th>
                      <th className="px-3 py-2">Balance</th>
                      <th className="px-3 py-2">Last activity</th>
                      <th className="px-3 py-2">History</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.clients.items.map((item) => (
                      <tr key={item.id} className="border-t border-[#e2e8f0] text-[#334155]">
                        <td className="px-3 py-2">
                          <span className="block font-medium">{item.name}</span>
                          <span className="block text-xs text-[#5a6d86]">{item.email}</span>
                        </td>
                        <td className="px-3 py-2">{formatPoints(item.balancePoints)} pts</td>
                        <td className="px-3 py-2">{formatDate(item.lastActivityAt)}</td>
                        <td className="px-3 py-2">
                          <Link
                            href={buildPageHref({
                              currencyCode: data.currencyCode,
                              clientId: item.id,
                              page: data.clients.page,
                              query,
                            })}
                            className="text-sm font-medium text-[#1d3652] underline underline-offset-4"
                          >
                            View details
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-4">
              <AdminPagination
                page={data.clients.page}
                totalPages={data.clients.totalPages}
                onChange={(nextPage) => buildPageHref({
                  currencyCode: data.currencyCode,
                  clientId: clientId ?? undefined,
                  page: nextPage,
                  query,
                })}
              />
            </div>
          </section>
        </div>

        <div className="space-y-5">
          <section className="rounded-xl border border-[#d3dbe5] bg-white p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-[#1f2735]">Manual grant</h2>
                <p className="mt-1 text-sm text-[#4b5a72]">
                  Grant loyalty points directly to a client. The administrator, reason, amount, and timestamp are recorded for auditing.
                </p>
              </div>
              <AdminLoyaltyManualGrantModal
                currencyCode={data.currencyCode}
                defaultClientEmail={data.selectedClient?.summary.client.email ?? ""}
                page={page}
                query={query}
                submitAction={grantLoyaltyPointsAction}
              />
            </div>
          </section>

          <section className="rounded-xl border border-[#d3dbe5] bg-white p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-[#1f2735]">Selected client</h2>
                <p className="mt-1 text-sm text-[#4b5a72]">
                  Loyalty summary and history for the selected client.
                </p>
              </div>
            </div>

            {data.selectedClient ? (
              <div className="mt-4 space-y-4">
                <div className="rounded-xl border border-[#d3dbe5] bg-[#f8fafc] p-4">
                  <p className="text-base font-semibold text-[#1f2735]">
                    {data.selectedClient.summary.client.name}
                  </p>
                  <p className="text-sm text-[#4b5a72]">{data.selectedClient.summary.client.email}</p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border border-[#d3dbe5] bg-white p-3">
                      <p className="text-xs uppercase tracking-wide text-[#5a6d86]">Balance</p>
                      <p className="mt-2 text-2xl font-semibold text-[#1f2735]">
                        {formatPoints(data.selectedClient.summary.balancePoints)} pts
                      </p>
                    </div>
                    <div className="rounded-lg border border-[#d3dbe5] bg-white p-3">
                      <p className="text-xs uppercase tracking-wide text-[#5a6d86]">Expiring next</p>
                      <p className="mt-2 text-sm font-medium text-[#1f2735]">
                        {data.selectedClient.summary.nextExpirationAt
                          ? `${formatPoints(data.selectedClient.summary.expiringPoints)} pts on ${formatDate(data.selectedClient.summary.nextExpirationAt)}`
                          : "No scheduled expiry"}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm text-[#4b5a72]">
                    <p>Lifetime earned: {formatPoints(data.selectedClient.summary.lifetimeEarnedPoints)} pts</p>
                    <p>Manual grants: {formatPoints(data.selectedClient.summary.manualGrantPoints)} pts</p>
                    <p>Reversed: {formatPoints(data.selectedClient.summary.reversedPoints)} pts</p>
                    <p>Expired: {formatPoints(data.selectedClient.summary.expiredPoints)} pts</p>
                  </div>
                </div>

                {data.selectedClient.history.length > 0 ? (
                  <div className="overflow-x-auto rounded-xl border border-[#d3dbe5]">
                    <table className="min-w-full text-sm">
                      <thead className="bg-[#f3f6fb] text-left text-xs uppercase tracking-wide text-[#5a6d86]">
                        <tr>
                          <th className="px-3 py-2">Date</th>
                          <th className="px-3 py-2">Type</th>
                          <th className="px-3 py-2">Points</th>
                          <th className="px-3 py-2">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.selectedClient.history.map((entry) => (
                          <tr key={entry.id} className="border-t border-[#e2e8f0] text-[#334155]">
                            <td className="px-3 py-2">{formatDate(entry.happenedAt)}</td>
                            <td className="px-3 py-2">{getEntryLabel(entry.entryType)}</td>
                            <td className="px-3 py-2">{formatPoints(entry.amountPoints)} pts</td>
                            <td className="px-3 py-2">{entry.reason ?? "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-[#cbd5e1] px-4 py-5 text-sm text-[#4b5a72]">
                    No loyalty history yet for this client.
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-4 rounded-md border border-dashed border-[#cbd5e1] px-4 py-5 text-sm text-[#4b5a72]">
                Select a client to review loyalty history and balances.
              </div>
            )}
          </section>
        </div>
      </section>
    </section>
  );
}
