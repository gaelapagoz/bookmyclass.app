import AdminLoyaltyCatalogEditor from "@/components/admin/AdminLoyaltyCatalogEditor";
import { requireAdminSession } from "@/lib/auth/require-auth";
import { getAdminLoyaltyOverview } from "@/lib/loyalty/loyalty-admin-service";

import { saveLoyaltyProgramAction } from "../../sales/loyalty/actions";

type SearchParams = Promise<{
  currencyCode?: string | string[];
  error?: string | string[];
  success?: string | string[];
}>;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AdminCatalogLoyaltyPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireAdminSession();
  const params = await searchParams;
  const currencyCode = firstParam(params.currencyCode)?.trim().toUpperCase();
  const error = firstParam(params.error)?.trim() ?? "";
  const success = firstParam(params.success)?.trim() ?? "";

  const data = await getAdminLoyaltyOverview({
    actorUserId: session.user.id,
    currencyCode,
    page: 1,
    pageSize: 20,
    historyLimit: 1,
  });

  const earningAmountDisplay = data.program ? (data.program.earningAmountMinor / 100).toFixed(2) : "1.00";
  const expirationDays = data.program?.pointsExpireAfterDays ?? 365;
  const reminderDays = data.program?.expirationReminderDays ?? 30;
  const maxManualGrantPoints = data.program?.maxManualGrantPoints ?? 5000;
  const rewardAmountDisplay = data.program ? (data.program.rewardAmountMinor / 100).toFixed(2) : "5.00";
  const rewardName = data.program?.rewardName ?? "5 EURO Reward";
  const rewardPointsRequired = data.program?.rewardPointsRequired ?? 500;

  return (
    <section className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold text-[#1f2735]">Catalog: Loyalty Points</h1>
        <p className="mt-1 text-sm text-[#4b5a72]">
          Configure purchase earning, expiration rules, and the fixed reward contract.
        </p>
      </header>

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

      <AdminLoyaltyCatalogEditor
        currencyCode={data.currencyCode}
        earningAmountDisplay={earningAmountDisplay}
        earningPoints={data.program?.earningPoints ?? 1}
        eligibleProductIds={data.eligibleProducts.map((product) => product.id)}
        expirationReminderDays={reminderDays}
        maxManualGrantPoints={maxManualGrantPoints}
        pointsExpireAfterDays={expirationDays}
        rewardAmountDisplay={rewardAmountDisplay}
        rewardName={rewardName}
        rewardPointsRequired={rewardPointsRequired}
        saveAction={saveLoyaltyProgramAction}
      />
    </section>
  );
}
