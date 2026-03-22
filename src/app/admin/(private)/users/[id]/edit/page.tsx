import Link from "next/link";
import { notFound } from "next/navigation";

import { updateUserAction } from "@/app/admin/(private)/actions";
import { getAdminUserById } from "@/lib/admin/admin-service";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string }>;

export default async function AdminUserEditPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const record = await getAdminUserById(id);

  if (!record) {
    notFound();
  }

  const { error } = await searchParams;

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-[#1f2735]">Edit User</h1>
        <Link href="/admin/users" className="text-sm text-[#2a4f78] underline underline-offset-4">
          Back to users
        </Link>
      </header>

      {error ? <p className="text-sm text-[#7b2d2d]">{error}</p> : null}

      <form action={updateUserAction.bind(null, id)} className="space-y-3 rounded-xl border border-[#d3dbe5] bg-white p-5">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm text-[#334155]">
            Name
            <input
              name="name"
              required
              defaultValue={record.name}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
          <label className="block text-sm text-[#334155]">
            Email
            <input
              name="email"
              type="email"
              required
              defaultValue={record.email}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm text-[#334155]">
            Role
            <select name="role" defaultValue={record.role} className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2">
              <option value="CLIENT">CLIENT</option>
              <option value="TEACHER">TEACHER</option>
              <option value="ADMIN">ADMIN</option>
              <option value="MASTER_ADMIN">MASTER_ADMIN</option>
            </select>
          </label>

          <label className="block text-sm text-[#334155]">
            New Password (optional)
            <input
              name="password"
              type="password"
              minLength={8}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
        </div>

        <label className="inline-flex items-center gap-2 text-sm text-[#334155]">
          <input type="checkbox" name="isActive" defaultChecked={record.isActive} /> Active
        </label>

        <button type="submit" className="rounded-md bg-[#1d3652] px-4 py-2 text-sm text-white">
          Update user
        </button>
      </form>
    </section>
  );
}
