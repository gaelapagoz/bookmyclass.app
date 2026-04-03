import Link from "next/link";
import { notFound } from "next/navigation";

import {
  adjustClientCreditsAction,
  cancelClientMembershipAction,
  uploadTeacherImageAction,
  updateUserAction,
} from "@/app/admin/(private)/actions";
import { getAdminClientActivityData, getAdminUserById } from "@/lib/admin/admin-service";
import { requireAdminSession } from "@/lib/auth/require-auth";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string; success?: string }>;

function toDateValue(value: string | null): string {
  if (!value) {
    return "";
  }

  return value.slice(0, 10);
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-BE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatCurrency(amountMinor: number, currencyCode: string): string {
  return new Intl.NumberFormat("en-BE", {
    style: "currency",
    currency: currencyCode,
  }).format(amountMinor / 100);
}

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

  const isTeacher = record.role === "TEACHER";
  const isClient = record.role === "CLIENT";
  const clientActivity = isClient ? await getAdminClientActivityData(id) : null;
  const adminSession = await requireAdminSession({ throwOnFailure: true });
  const { error, success } = await searchParams;
  const isMasterAdminRestricted = record.role === "MASTER_ADMIN" && adminSession.user.role !== "MASTER_ADMIN";

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-[#1f2735]">View User</h1>
        <Link href="/admin/users" className="text-sm text-[#2a4f78] underline underline-offset-4">
          Back to users
        </Link>
      </header>

      {error ? <p className="text-sm text-[#7b2d2d]">{error}</p> : null}
      {success ? <p className="text-sm text-[#0f5132]">{success}</p> : null}
      {isMasterAdminRestricted ? (
        <p className="text-sm text-[#7b2d2d]">
          Only MASTER_ADMIN can manage another MASTER_ADMIN.
        </p>
      ) : null}

      <section className="rounded-xl border border-[#d3dbe5] bg-white p-5">
      <form action={updateUserAction.bind(null, id)} className="space-y-3">
        <fieldset disabled={isMasterAdminRestricted} className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm text-[#334155]">
            First Name
            <input
              name="firstName"
              required
              defaultValue={record.firstName}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
          <label className="block text-sm text-[#334155]">
            Last Name
            <input
              name="lastName"
              required
              defaultValue={record.lastName}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
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

          <label className="block text-sm text-[#334155]">
            Phone
            <input
              name="phone"
              defaultValue={record.phone}
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
              disabled={isMasterAdminRestricted}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
        </div>

        {isTeacher ? (
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block text-sm text-[#334155] md:col-span-2">
              Bio
              <textarea
                name="bio"
                rows={3}
                defaultValue={record.bio}
                className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
              />
            </label>
            <label className="block text-sm text-[#334155]">
              Specialties (comma or new line)
              <textarea
                name="specialties"
                rows={3}
                defaultValue={record.specialties.join("\n")}
                className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
              />
            </label>
            <label className="block text-sm text-[#334155]">
              Certifications (comma or new line)
              <textarea
                name="certifications"
                rows={3}
                defaultValue={record.certifications.join("\n")}
                className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
              />
            </label>
            <label className="block text-sm text-[#334155]">
              Hire Date
              <input
                name="hireDate"
                type="date"
                defaultValue={toDateValue(record.hireDate)}
                className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
              />
            </label>
          </div>
        ) : (
          <label className="block text-sm text-[#334155]">
            Notes
            <textarea
              name="notes"
              rows={3}
              defaultValue={record.notes}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
        )}

        <div className="pt-2">
          <label className="inline-flex items-center gap-2 text-sm text-[#334155]">
            <input type="checkbox" name="isActive" defaultChecked={record.isActive} /> Active
          </label>
        </div>

        <div className="pt-2">
          <button type="submit" className="rounded-md bg-[#1d3652] px-4 py-2 text-sm text-white">
            Update user
          </button>
        </div>
        </fieldset>
      </form>
      </section>

      {isTeacher ? (
        <section className="rounded-xl border border-[#d3dbe5] bg-white p-5">
          <h2 className="text-lg font-semibold text-[#1f2735]">Teacher Picture</h2>
          {record.image ? (
            <img
              src={record.image}
              alt={`${record.name} picture`}
              className="mt-3 h-40 w-40 rounded-md border border-[#d3dbe5] object-cover"
              data-testid="teacher-image-preview"
            />
          ) : (
            <p className="mt-3 text-sm text-[#4b5a72]">No teacher picture uploaded yet.</p>
          )}

          <form action={uploadTeacherImageAction} className="mt-4 flex flex-col gap-3 md:max-w-md">
            <input type="hidden" name="userId" value={id} />
            <label className="block text-sm text-[#334155]">
              Upload picture (JPG, PNG, WEBP, max 5MB)
              <input
                name="teacherImage"
                type="file"
                required
                accept="image/jpeg,image/png,image/webp"
                className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
              />
            </label>
            <div>
              <button type="submit" className="rounded-md border border-[#d3dbe5] px-4 py-2 text-sm hover:bg-[#f3f6fb]">
                Upload teacher picture
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {isClient && clientActivity ? (
        <section className="space-y-4 rounded-xl border border-[#d3dbe5] bg-white p-5">
          <h2 className="text-lg font-semibold text-[#1f2735]">Client Activity</h2>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-md bg-[#f3f6fb] px-3 py-2">
              <p className="text-xs uppercase tracking-wide text-[#5a6d86]">Classes Booked</p>
              <p className="mt-1 text-xl font-semibold text-[#1f2735]">{clientActivity.classesBooked}</p>
            </div>
            <div className="rounded-md bg-[#f3f6fb] px-3 py-2">
              <p className="text-xs uppercase tracking-wide text-[#5a6d86]">Classes Cancelled</p>
              <p className="mt-1 text-xl font-semibold text-[#1f2735]">{clientActivity.classesCancelled}</p>
            </div>
            <div className="rounded-md bg-[#f3f6fb] px-3 py-2">
              <p className="text-xs uppercase tracking-wide text-[#5a6d86]">Credits Remaining</p>
              <p className="mt-1 text-xl font-semibold text-[#1f2735]">{clientActivity.creditsRemaining}</p>
              <p className="mt-1 text-xs text-[#5a6d86]">
                Next expiration: {clientActivity.nextCreditExpiration ? formatDateTime(clientActivity.nextCreditExpiration) : "-"}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[#5a6d86]">Plans Bought</h3>
            {clientActivity.plansBought.length === 0 ? (
              <p className="text-sm text-[#4b5a72]">No paid plans found.</p>
            ) : (
              <ul className="space-y-2">
                {clientActivity.plansBought.map((plan) => (
                  <li key={`${plan.orderId}-${plan.productName}`} className="rounded-md border border-[#e2e8f0] px-3 py-2 text-sm text-[#334155]">
                    <p className="font-medium">{plan.productName}</p>
                    <p className="text-xs text-[#5a6d86]">
                      {plan.priceName} - {formatCurrency(plan.amountMinor, plan.currencyCode)} - {formatDateTime(plan.purchasedAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[#5a6d86]">Outstanding Memberships</h3>
            {clientActivity.outstandingMemberships.length === 0 ? (
              <p className="text-sm text-[#4b5a72]">No active memberships.</p>
            ) : (
              <ul className="space-y-2">
                {clientActivity.outstandingMemberships.map((subscription) => (
                  <li key={subscription.id} className="rounded-md border border-[#e2e8f0] px-3 py-2 text-sm text-[#334155]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">{subscription.productName}</p>
                        <p className="text-xs text-[#5a6d86]">Ends {formatDateTime(subscription.currentPeriodEnd)} - {subscription.status}</p>
                      </div>
                      <form action={cancelClientMembershipAction}>
                        <input type="hidden" name="clientId" value={id} />
                        <input type="hidden" name="subscriptionContractId" value={subscription.id} />
                        <button type="submit" className="rounded-md border border-[#d3dbe5] px-3 py-1 text-xs hover:bg-[#f3f6fb]">
                          Cancel membership
                        </button>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[#5a6d86]">Credit Entitlements</h3>
            {clientActivity.creditEntitlements.length === 0 ? (
              <p className="text-sm text-[#4b5a72]">No active credit entitlement.</p>
            ) : (
              <ul className="space-y-2">
                {clientActivity.creditEntitlements.map((entitlement) => (
                  <li key={entitlement.entitlementId} className="rounded-md border border-[#e2e8f0] p-3 text-sm text-[#334155]">
                    <p className="font-medium">{entitlement.productName}</p>
                    <p className="mt-1 text-xs text-[#5a6d86]">
                      Credits: {entitlement.remainingCredits} - Expires: {entitlement.expiresAt ? formatDateTime(entitlement.expiresAt) : "-"}
                    </p>
                    <form action={adjustClientCreditsAction} className="mt-2 grid gap-2 md:grid-cols-4" data-testid="client-credits-adjust-form">
                      <input type="hidden" name="userId" value={id} />
                      <input type="hidden" name="entitlementId" value={entitlement.entitlementId} />
                      <label className="text-xs text-[#334155]">
                        Credits Adjustment (+/-)
                        <input name="creditDelta" type="number" required className="mt-1 w-full rounded-md border border-[#d3dbe5] px-2 py-1" />
                      </label>
                      <label className="text-xs text-[#334155] md:col-span-2">
                        New Expiration (optional)
                        <input name="expiresAt" type="date" className="mt-1 w-full rounded-md border border-[#d3dbe5] px-2 py-1" />
                      </label>
                      <label className="text-xs text-[#334155] md:col-span-4">
                        Audit reason (optional)
                        <input name="reason" className="mt-1 w-full rounded-md border border-[#d3dbe5] px-2 py-1" />
                      </label>
                      <div className="flex items-end">
                        <button type="submit" className="rounded-md border border-[#d3dbe5] px-3 py-1 text-xs hover:bg-[#f3f6fb]">
                          Save
                        </button>
                      </div>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <form action={adjustClientCreditsAction} className="grid gap-2 rounded-md border border-[#e2e8f0] p-3 md:grid-cols-4" data-testid="client-credits-create-form">
            <input type="hidden" name="userId" value={id} />
            <label className="text-xs text-[#334155]">
              Product
              <select name="productId" className="mt-1 w-full rounded-md border border-[#d3dbe5] px-2 py-1">
                {clientActivity.eligibleCreditProducts.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-[#334155]">
              Add Credits
              <input name="creditDelta" type="number" min={1} required className="mt-1 w-full rounded-md border border-[#d3dbe5] px-2 py-1" />
            </label>
            <label className="text-xs text-[#334155]">
              Expiration Date
              <input name="expiresAt" type="date" className="mt-1 w-full rounded-md border border-[#d3dbe5] px-2 py-1" />
            </label>
            <label className="text-xs text-[#334155] md:col-span-4">
              Audit reason (optional)
              <input name="reason" className="mt-1 w-full rounded-md border border-[#d3dbe5] px-2 py-1" />
            </label>
            <div className="flex items-end">
              <button type="submit" className="rounded-md bg-[#1d3652] px-3 py-1 text-xs text-white">
                Add credits + expiration
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </section>
  );
}
