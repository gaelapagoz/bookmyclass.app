import Link from "next/link";

import AdminUsersBulkMarketingForm from "@/components/admin/AdminUsersBulkMarketingForm";
import type { AdminUserItem } from "@/lib/admin/admin-service";

type MarketingSegmentOption = {
  id: string;
  name: string;
};

type MarketingBulkActions = {
  segments: MarketingSegmentOption[];
  setStatusAction: (formData: FormData) => void | Promise<void>;
  addSegmentsAction: (formData: FormData) => void | Promise<void>;
  removeSegmentsAction: (formData: FormData) => void | Promise<void>;
};

type Props = {
  title: string;
  users: AdminUserItem[];
  marketingBulkActions?: MarketingBulkActions;
};

function formatDateTime(value: string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-BE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function AdminUsersRoleTable({ title, users, marketingBulkActions }: Props) {
  if (!marketingBulkActions) {
    return (
      <article className="overflow-x-auto rounded-xl border border-[#d3dbe5] bg-white">
        <div className="border-b border-[#e2e8f0] bg-[#f8fafc] px-4 py-3">
          <h2 className="text-base font-semibold text-[#1f2735]">{title}</h2>
        </div>
        {users.length === 0 ? (
          <p className="px-4 py-3 text-sm text-[#4b5a72]">No users in this role.</p>
        ) : (
          <table className="min-w-full table-fixed text-sm">
            <thead className="bg-[#f3f6fb] text-left text-xs uppercase tracking-wide text-[#5a6d86]">
              <tr>
                <th className="w-[26%] px-3 py-2">Name</th>
                <th className="w-[29%] px-3 py-2">Email</th>
                <th className="w-[12%] px-3 py-2">Status</th>
                <th className="w-[23%] px-3 py-2">Last Login</th>
                <th className="w-[10%] px-3 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((item) => (
                <tr key={item.id} className="border-t border-[#e2e8f0] text-[#334155]">
                  <td className="px-3 py-2 font-medium">{item.name}</td>
                  <td className="px-3 py-2">{item.email}</td>
                  <td className="px-3 py-2">{item.isActive ? "Active" : "Inactive"}</td>
                  <td className="px-3 py-2">{formatDateTime(item.lastLoginAt)}</td>
                  <td className="px-3 py-2">
                    <Link href={`/admin/users/${item.id}/edit`} className="text-[#2a4f78] underline underline-offset-4">
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </article>
    );
  }

  return (
    <article className="overflow-x-auto rounded-xl border border-[#d3dbe5] bg-white">
      <div className="border-b border-[#e2e8f0] bg-[#f8fafc] px-4 py-3">
        <h2 className="text-base font-semibold text-[#1f2735]">{title}</h2>
      </div>

      {users.length === 0 ? (
        <p className="px-4 py-3 text-sm text-[#4b5a72]">No users in this role.</p>
      ) : (
        <AdminUsersBulkMarketingForm
          users={users}
          segments={marketingBulkActions.segments}
          setStatusAction={marketingBulkActions.setStatusAction}
          addSegmentsAction={marketingBulkActions.addSegmentsAction}
          removeSegmentsAction={marketingBulkActions.removeSegmentsAction}
        />
      )}
    </article>
  );
}
