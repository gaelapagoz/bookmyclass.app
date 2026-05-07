import { Weekday } from "@prisma/client";

import {
  createSiteWeeklyScheduleEntryAction,
  deleteSiteWeeklyScheduleEntryAction,
  updateCancellationPeriodAction,
  updateSiteTimeZoneAction,
  updateSiteWeeklyScheduleEntryAction,
  uploadAgendaPdfAction,
} from "@/app/admin/(private)/actions";
import {
  getAdminCancellationPeriodHours,
  getAdminSiteTimeZone,
  listAdminSiteScheduleServiceOptions,
  listAdminSiteWeeklyScheduleEntries,
} from "@/lib/admin/admin-service";
import { getActiveAgendaPdfDocument } from "@/lib/public-documents/agenda-document-service";
import { getSiteTimeZoneOptions } from "@/lib/site-settings/site-settings-service";

type SearchParams = Promise<{ error?: string; success?: string }>;
export const dynamic = "force-dynamic";

const WEEKDAY_OPTIONS: Array<{ value: Weekday; label: string; short: string }> = [
  { value: Weekday.MONDAY, label: "Monday", short: "Mon" },
  { value: Weekday.TUESDAY, label: "Tuesday", short: "Tue" },
  { value: Weekday.WEDNESDAY, label: "Wednesday", short: "Wed" },
  { value: Weekday.THURSDAY, label: "Thursday", short: "Thu" },
  { value: Weekday.FRIDAY, label: "Friday", short: "Fri" },
  { value: Weekday.SATURDAY, label: "Saturday", short: "Sat" },
  { value: Weekday.SUNDAY, label: "Sunday", short: "Sun" },
];

export default async function AdminManageSitePage({ searchParams }: { searchParams: SearchParams }) {
  const { error, success } = await searchParams;

  try {
    const [agendaPdf, scheduleEntries, cancellationPeriodHours, siteTimeZone, serviceOptions] = await Promise.all([
      getActiveAgendaPdfDocument(),
      listAdminSiteWeeklyScheduleEntries(),
      getAdminCancellationPeriodHours(),
      getAdminSiteTimeZone(),
      listAdminSiteScheduleServiceOptions(),
    ]);
    const siteTimeZoneOptions = getSiteTimeZoneOptions();
    const hasServiceOptions = serviceOptions.length > 0;
    const serviceOptionIds = new Set(serviceOptions.map((option) => option.id));

    return (
      <section className="space-y-4">
        <header>
          <h1 className="text-2xl font-semibold text-[#1f2735]">Manage Site</h1>
          <p className="mt-1 text-sm text-[#4b5a72]">Manage public website assets and static homepage weekly schedule.</p>
        </header>

        {error ? <p className="text-sm text-[#7b2d2d]">{error}</p> : null}
        {success ? <p className="text-sm text-[#1d6d34]">{success}</p> : null}

        <section className="rounded-xl border border-[#d3dbe5] bg-white p-4">
          <h2 className="text-lg font-semibold text-[#1f2735]">Agenda PDF</h2>
          <p className="mt-1 text-sm text-[#4b5a72]">Upload or replace the public agenda PDF download.</p>
          <p className="mt-2 text-xs text-[#5a6d86]">Current file: {agendaPdf ? agendaPdf.fileUrl : "No active agenda PDF."}</p>
          <form action={uploadAgendaPdfAction} className="mt-3 flex flex-wrap items-end gap-3">
            <input type="hidden" name="returnTo" value="/admin/manage-site" />
            <label className="text-sm text-[#334155]">
              PDF file
              <input
                type="file"
                name="agendaPdf"
                accept="application/pdf"
                required
                className="mt-1 block rounded-md border border-[#d3dbe5] bg-white px-3 py-2 text-sm"
              />
            </label>
            <button type="submit" className="rounded-md bg-[#1d3652] px-4 py-2 text-sm text-white hover:opacity-90">
              Upload
            </button>
          </form>
        </section>

        <section className="rounded-xl border border-[#d3dbe5] bg-white p-4">
          <h2 className="text-lg font-semibold text-[#1f2735]">Agenda Schedule</h2>
          <p className="mt-1 text-sm text-[#4b5a72]">
            This schedule is manually managed for homepage display and is independent from live sessions.
          </p>
          {!hasServiceOptions ? (
            <p className="mt-2 rounded-md border border-[#e2e8f0] bg-[#f8fbff] px-3 py-2 text-xs text-[#5a6d86]">
              No booking services exist yet. Create a booking service first, then add agenda schedule rows.
            </p>
          ) : null}

          <div className="mt-4 overflow-x-auto">
            <div className="grid min-w-[980px] grid-cols-7 gap-3">
              {WEEKDAY_OPTIONS.map((day) => {
                const dayEntries = scheduleEntries.filter((entry) => entry.dayOfWeek === day.value);
                return (
                  <section key={day.value} className="rounded-lg border border-[#d3dbe5] bg-[#f8fbff]">
                    <header className="border-b border-[#d3dbe5] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[#5a6d86]">
                      {day.label}
                    </header>

                    <div className="space-y-2 p-2">
                      {dayEntries.length === 0 ? (
                        <p className="rounded-md border border-dashed border-[#d3dbe5] bg-white px-2 py-3 text-xs text-[#7a869a]">No service</p>
                      ) : (
                        dayEntries.map((entry) => (
                          <article key={entry.id} className="rounded-md border border-[#d3dbe5] bg-white p-2">
                            <p className="text-sm font-semibold text-[#1f2735]">{entry.label}</p>
                            <p className="mt-0.5 text-xs text-[#4b5a72]">
                              {entry.startTime} - {entry.endTime}
                            </p>

                            <form action={updateSiteWeeklyScheduleEntryAction} className="mt-2 grid grid-cols-2 gap-1">
                              <input type="hidden" name="id" value={entry.id} />
                              <input type="hidden" name="dayOfWeek" value={entry.dayOfWeek} />
                              <input type="hidden" name="displayOrder" value={String(entry.displayOrder)} />
                              <input type="hidden" name="isActive" value={entry.isActive ? "on" : ""} />
                              <label className="col-span-2 text-xs text-[#334155]">
                                Service
                                <select
                                  name="serviceId"
                                  defaultValue={entry.serviceId ?? ""}
                                  required
                                  disabled={!hasServiceOptions && !entry.serviceId}
                                  className="mt-1 block w-full rounded-md border border-[#d3dbe5] bg-white px-2 py-1 text-xs"
                                >
                                  <option value="">Select a booking service</option>
                                  {entry.serviceId && !serviceOptionIds.has(entry.serviceId) ? (
                                    <option value={entry.serviceId}>{entry.label} (Archived)</option>
                                  ) : null}
                                  {serviceOptions.map((option) => (
                                    <option key={option.id} value={option.id}>
                                      {option.name}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <input
                                type="time"
                                name="startTime"
                                defaultValue={entry.startTime}
                                required
                                className="rounded-md border border-[#d3dbe5] bg-white px-2 py-1 text-xs"
                              />
                              <input
                                type="time"
                                name="endTime"
                                defaultValue={entry.endTime}
                                required
                                className="rounded-md border border-[#d3dbe5] bg-white px-2 py-1 text-xs"
                              />
                              <button
                                type="submit"
                                className="col-span-2 rounded-md border border-[#d3dbe5] px-2 py-1 text-xs font-medium text-[#1f2735] hover:bg-[#f3f6fb]"
                              >
                                Save
                              </button>
                            </form>

                            <form action={deleteSiteWeeklyScheduleEntryAction} className="mt-1">
                              <input type="hidden" name="id" value={entry.id} />
                              <button type="submit" className="w-full rounded-md px-2 py-1 text-right text-xs font-semibold text-[#22384f] hover:underline">
                                Remove Service
                              </button>
                            </form>
                          </article>
                        ))
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>

          <form action={createSiteWeeklyScheduleEntryAction} className="mt-4 rounded-lg border border-[#d3dbe5] bg-[#f8fbff] p-3">
            <div className="grid gap-3 md:grid-cols-3">
              <label className="text-sm text-[#334155]">
                Service
                <select
                  name="serviceId"
                  required
                  disabled={!hasServiceOptions}
                  className="mt-1 block w-full rounded-md border border-[#d3dbe5] bg-white px-3 py-2 text-sm"
                  defaultValue=""
                >
                  <option value="">Select a booking service</option>
                  {serviceOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm text-[#334155]">
                Start Time
                <input
                  type="time"
                  name="startTime"
                  required
                  defaultValue="07:00"
                  className="mt-1 block w-full rounded-md border border-[#d3dbe5] bg-white px-3 py-2 text-sm"
                />
              </label>

              <label className="text-sm text-[#334155]">
                End Time
                <input
                  type="time"
                  name="endTime"
                  required
                  defaultValue="07:45"
                  className="mt-1 block w-full rounded-md border border-[#d3dbe5] bg-white px-3 py-2 text-sm"
                />
              </label>
            </div>

            <input type="hidden" name="displayOrder" value="0" />
            <input type="hidden" name="isActive" value="on" />
            <input type="hidden" name="dayOfWeek" value={Weekday.MONDAY} />

            <div className="mt-3">
              <p className="text-sm text-[#334155]">Repeat on</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {WEEKDAY_OPTIONS.map((day) => (
                  <label key={day.value} className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-[#c8d4e5] bg-white px-3 py-1 text-xs text-[#334155]">
                    <input type="checkbox" name="repeatOn" value={day.value} className="h-3 w-3" />
                    {day.short}
                  </label>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={!hasServiceOptions}
              className="mt-4 rounded-md bg-[#1d3652] px-4 py-2 text-sm text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Add Service
            </button>
          </form>
        </section>

        <section className="rounded-xl border border-[#d3dbe5] bg-white p-4">
          <h2 className="text-lg font-semibold text-[#1f2735]">Configure Cancellation Period</h2>
          <p className="mt-1 text-sm text-[#4b5a72]">Set the global cancellation window in hours for booking policy enforcement.</p>

          <form action={updateCancellationPeriodAction} className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-sm text-[#334155]">
              Cancellation period (hours)
              <input
                type="number"
                name="cancellationPeriodHours"
                min={1}
                step={1}
                required
                defaultValue={cancellationPeriodHours}
                className="mt-1 block w-40 rounded-md border border-[#d3dbe5] bg-white px-3 py-2 text-sm"
              />
            </label>
            <button type="submit" className="rounded-md bg-[#1d3652] px-4 py-2 text-sm text-white hover:opacity-90">
              Save
            </button>
          </form>
        </section>

        <section className="rounded-xl border border-[#d3dbe5] bg-white p-4">
          <h2 className="text-lg font-semibold text-[#1f2735]">Configure Site Timezone</h2>
          <p className="mt-1 text-sm text-[#4b5a72]">Set the timezone used for availability dates, kiosk labels, and check-in windows.</p>

          <form action={updateSiteTimeZoneAction} className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-sm text-[#334155]">
              Site timezone
              <select
                name="timeZone"
                required
                defaultValue={siteTimeZone}
                className="mt-1 block w-full min-w-64 rounded-md border border-[#d3dbe5] bg-white px-3 py-2 text-sm"
              >
                {siteTimeZoneOptions.map((timeZone) => (
                  <option key={timeZone.value} value={timeZone.value}>
                    {timeZone.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="rounded-md bg-[#1d3652] px-4 py-2 text-sm text-white hover:opacity-90">
              Save
            </button>
          </form>
        </section>
      </section>
    );
  } catch {
    return (
      <section className="rounded-xl border border-[#d3dbe5] bg-white p-6">
        <h1 className="text-2xl font-semibold text-[#1f2735]">Manage Site</h1>
        <p className="mt-2 text-sm text-[#7b2d2d]">Unable to load site management data right now.</p>
      </section>
    );
  }
}
