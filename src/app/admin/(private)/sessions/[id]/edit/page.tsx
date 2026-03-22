import Link from "next/link";
import { notFound } from "next/navigation";

import { updateSessionAction } from "@/app/admin/(private)/actions";
import { getAdminSessionById, getAdminSessionOptions } from "@/lib/admin/admin-service";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string }>;

function toDateTimeLocal(value: Date): string {
  const iso = new Date(value).toISOString();
  return iso.slice(0, 16);
}

export default async function AdminSessionEditPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const [record, options] = await Promise.all([getAdminSessionById(id), getAdminSessionOptions()]);

  if (!record) {
    notFound();
  }

  const { error } = await searchParams;

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-[#1f2735]">Edit Session</h1>
        <Link href="/admin/sessions" className="text-sm text-[#2a4f78] underline underline-offset-4">
          Back to sessions
        </Link>
      </header>

      {error ? <p className="text-sm text-[#7b2d2d]">{error}</p> : null}

      <form action={updateSessionAction.bind(null, id)} className="space-y-3 rounded-xl border border-[#d3dbe5] bg-white p-5">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm text-[#334155]">
            Class Template
            <select
              name="classTemplateId"
              required
              defaultValue={record.classTemplateId}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            >
              {options.templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.title}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm text-[#334155]">
            Teacher
            <select
              name="teacherId"
              required
              defaultValue={record.teacherId}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            >
              {options.teachers.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block text-sm text-[#334155]">
          Title
          <input
            name="title"
            required
            defaultValue={record.title}
            className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
          />
        </label>

        <label className="block text-sm text-[#334155]">
          Description
          <textarea
            name="description"
            rows={3}
            defaultValue={record.description ?? ""}
            className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
          />
        </label>

        <label className="block text-sm text-[#334155]">
          Location
          <input
            name="location"
            defaultValue={record.location ?? ""}
            className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
          />
        </label>

        <div className="grid gap-3 md:grid-cols-3">
          <label className="block text-sm text-[#334155]">
            Starts At
            <input
              name="startsAt"
              type="datetime-local"
              required
              defaultValue={toDateTimeLocal(record.startsAt)}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
          <label className="block text-sm text-[#334155]">
            Ends At
            <input
              name="endsAt"
              type="datetime-local"
              required
              defaultValue={toDateTimeLocal(record.endsAt)}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
          <label className="block text-sm text-[#334155]">
            Capacity
            <input
              name="capacity"
              type="number"
              min={1}
              required
              defaultValue={record.capacity}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
        </div>

        <label className="block text-sm text-[#334155]">
          Status
          <select
            name="status"
            defaultValue={record.status}
            className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
          >
            <option value="SCHEDULED">SCHEDULED</option>
            <option value="CANCELLED">CANCELLED</option>
            <option value="COMPLETED">COMPLETED</option>
          </select>
        </label>

        <label className="inline-flex items-center gap-2 text-sm text-[#334155]">
          <input type="checkbox" name="isPublished" defaultChecked={record.isPublished} /> Published
        </label>

        <button type="submit" className="rounded-md bg-[#1d3652] px-4 py-2 text-sm text-white">
          Update session
        </button>
      </form>
    </section>
  );
}
