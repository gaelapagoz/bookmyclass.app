import Link from "next/link";

import { createUserAction } from "@/app/admin/(private)/actions";
import { requireAdminSession } from "@/lib/auth/require-auth";

type SearchParams = Promise<{ error?: string }>;

export default async function AdminUserCreatePage({ searchParams }: { searchParams: SearchParams }) {
  const { error } = await searchParams;
  const adminSession = await requireAdminSession({ throwOnFailure: true });
  const canAssignMasterAdmin = adminSession.user.role === "MASTER_ADMIN";

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-[#1f2735]">Create User</h1>
        <Link href="/admin/users" className="text-sm text-[#2a4f78] underline underline-offset-4">
          Back to users
        </Link>
      </header>

      {error ? <p className="text-sm text-[#7b2d2d]">{error}</p> : null}

      <form action={createUserAction} className="space-y-3 rounded-xl border border-[#d3dbe5] bg-white p-5">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm text-[#334155]">
            Name
            <input name="name" required className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
          </label>
          <label className="block text-sm text-[#334155]">
            Email
            <input name="email" type="email" required className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm text-[#334155]">
            Role
            <select name="role" defaultValue="CLIENT" className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2">
              <option value="CLIENT">CLIENT</option>
              <option value="TEACHER">TEACHER</option>
              <option value="ADMIN">ADMIN</option>
              {canAssignMasterAdmin ? <option value="MASTER_ADMIN">MASTER_ADMIN</option> : null}
            </select>
          </label>

          <label className="block text-sm text-[#334155]">
            Password
            <input
              name="password"
              type="password"
              required
              minLength={8}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
        </div>

        <label className="inline-flex items-center gap-2 text-sm text-[#334155]">
          <input type="checkbox" name="isActive" defaultChecked /> Active
        </label>

        <button type="submit" className="rounded-md bg-[#1d3652] px-4 py-2 text-sm text-white">
          Save user
        </button>
      </form>
    </section>
  );
}
