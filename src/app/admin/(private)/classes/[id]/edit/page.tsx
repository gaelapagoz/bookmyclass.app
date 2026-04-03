import Link from "next/link";
import { notFound } from "next/navigation";

import { updateClassAction, uploadClassImageAction } from "@/app/admin/(private)/actions";
import ClassScheduleFields from "@/components/admin/ClassScheduleFields";
import {
  getAdminClassById,
  getAdminClassScheduleOptions,
  getClassCategoryOptions,
} from "@/lib/admin/admin-service";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string }>;

export default async function AdminClassEditPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const [record, categories, teachers] = await Promise.all([
    getAdminClassById(id),
    getClassCategoryOptions(),
    getAdminClassScheduleOptions(),
  ]);

  if (!record) {
    notFound();
  }

  const { error } = await searchParams;

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-[#1f2735]">Edit Booking Service</h1>
        <Link href="/admin/classes" className="text-sm text-[#2a4f78] underline underline-offset-4">
          Back to booking services
        </Link>
      </header>

      {error ? <p className="text-sm text-[#7b2d2d]">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <form action={updateClassAction.bind(null, id)} className="space-y-3">
          <section className="space-y-3 rounded-xl border border-[#d3dbe5] bg-white p-5">
            <label className="block text-sm text-[#334155]">
              Category
              <select
                name="categoryId"
                required
                defaultValue={record.categoryId}
                className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
              >
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid gap-2 md:grid-cols-2">
              <label className="block text-sm text-[#334155]">
                Name
                <input
                  name="name"
                  required
                  defaultValue={record.name}
                  className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
                />
              </label>
            </div>

            <label className="block text-sm text-[#334155]">
              Description
              <textarea
                name="description"
                rows={3}
                defaultValue={record.description ?? ""}
                className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
              />
            </label>

            <div className="grid gap-2 md:grid-cols-3">
              <label className="block text-sm text-[#334155]">
                Default Duration (min)
                <input
                  name="defaultDurationMinutes"
                  type="number"
                  min={1}
                  required
                  defaultValue={record.defaultDurationMinutes}
                  className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
                />
              </label>
              <label className="block text-sm text-[#334155]">
                Default Capacity
                <input
                  name="defaultCapacity"
                  type="number"
                  min={1}
                  required
                  defaultValue={record.defaultCapacity}
                  className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
                />
              </label>
              <label className="block text-sm text-[#334155]">
                Sort Order
                <input
                  name="sortOrder"
                  type="number"
                  min={0}
                  required
                  defaultValue={record.sortOrder}
                  className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
                />
              </label>
            </div>

            <div className="flex flex-wrap gap-4 text-sm text-[#334155]">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" name="isActive" defaultChecked={record.isActive} /> Active
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" name="isVisible" defaultChecked={record.isVisible} /> Visible
              </label>
            </div>

          </section>
          <ClassScheduleFields
            teachers={teachers}
            defaultValues={{
              defaultTeacherId: record.schedule.defaultTeacherId,
              startTime: record.schedule.startTime,
              endTime: record.schedule.endTime,
              isRecurring: record.schedule.isRecurring,
              date: record.schedule.date,
              weekdays: record.schedule.weekdays,
              endDate: record.schedule.endDate,
            }}
          />
          <button type="submit" className="rounded-md bg-[#1d3652] px-4 py-2 text-sm text-white">
            Update class
          </button>
        </form>

        <section className="rounded-xl border border-[#d3dbe5] bg-white p-5">
          <h2 className="text-lg font-semibold text-[#1f2735]">Service Image</h2>
          {record.imageUrl ? (
            <div className="mt-3 h-[430px] w-full overflow-hidden rounded-md border border-[#d3dbe5]" data-testid="class-image-preview-container">
              <img
                src={record.imageUrl}
                alt={`${record.name} image`}
                className="h-full w-full object-cover object-center"
                data-testid="class-image-preview"
              />
            </div>
          ) : (
            <p className="mt-3 text-sm text-[#4b5a72]">No service image uploaded yet.</p>
          )}

          <form action={uploadClassImageAction} className="mt-4 flex w-full flex-col gap-3">
            <input type="hidden" name="classTypeId" value={id} />
            <label className="block text-sm text-[#334155]">
              Upload image (JPG, PNG, WEBP, max 5MB)
              <input
                name="classImage"
                type="file"
                required
                accept="image/jpeg,image/png,image/webp"
                className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
              />
            </label>
            <div>
              <button type="submit" className="rounded-md border border-[#d3dbe5] px-4 py-2 text-sm hover:bg-[#f3f6fb]">
                Upload service image
              </button>
            </div>
          </form>
        </section>
      </div>
    </section>
  );
}

