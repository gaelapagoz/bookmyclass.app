import Link from "next/link";

import AdminUsersRoleTable from "@/components/admin/AdminUsersRoleTable";
import { getAdminUsersData } from "@/lib/admin/admin-service";

export default async function AdminUsersPage() {
  try {
    const users = await getAdminUsersData();
    const sections = [
      { title: "Master Admins", role: "MASTER_ADMIN" },
      { title: "Admins", role: "ADMIN" },
      { title: "Teachers", role: "TEACHER" },
      { title: "Clients / Users", role: "CLIENT" },
    ] as const;

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
          <div className="space-y-4">
            {sections.map((section) => (
              <AdminUsersRoleTable
                key={section.role}
                title={section.title}
                users={users.filter((item) => item.role === section.role)}
              />
            ))}
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
