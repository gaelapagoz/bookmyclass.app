import Link from "next/link";

import { getAdminUsersData } from "@/lib/admin/admin-service";

function formatDateTime(value: string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-BE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function AdminUsersPage() {
  try {
    const users = await getAdminUsersData();

    return (
      <section className="space-y-4">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-[#1f2735]">Users</h1>
            <p className="mt-1 text-sm text-[#4b5a72]">Manage users and access roles.</p>
          </div>
          <Link href="/admin/users/new" className="rounded-md bg-[#1d3652] px-3 py-2 text-sm text-white">
            Create user
          </Link>
        </header>

        {users.length === 0 ? (
          <div className="rounded-xl border border-[#d3dbe5] bg-white p-5 text-sm text-[#4b5a72]">
            No users found.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[#d3dbe5] bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-[#f3f6fb] text-left text-xs uppercase tracking-wide text-[#5a6d86]">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Last Login</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((item) => (
                  <tr key={item.id} className="border-t border-[#e2e8f0] text-[#334155]">
                    <td className="px-3 py-2 font-medium">{item.name}</td>
                    <td className="px-3 py-2">{item.email}</td>
                    <td className="px-3 py-2">{item.role}</td>
                    <td className="px-3 py-2">{item.isActive ? "Active" : "Inactive"}</td>
                    <td className="px-3 py-2">{formatDateTime(item.lastLoginAt)}</td>
                    <td className="px-3 py-2">
                      <Link href={`/admin/users/${item.id}/edit`} className="text-[#2a4f78] underline underline-offset-4">
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    );
  } catch {
    return (
      <section className="rounded-xl border border-[#d3dbe5] bg-white p-6">
        <h1 className="text-2xl font-semibold text-[#1f2735]">Users</h1>
        <p className="mt-2 text-sm text-[#7b2d2d]">Unable to load users right now.</p>
      </section>
    );
  }
}

