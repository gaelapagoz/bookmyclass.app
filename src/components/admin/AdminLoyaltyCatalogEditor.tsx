"use client";

import { useMemo, useState } from "react";

type LoyaltyRewardDefinition = {
  id: string;
  name: string;
  pointsRequired: number;
  amountMinor: number;
  isActive: boolean;
};

type LoyaltyCatalogEditorProps = {
  currencyCode: string;
  earningAmountDisplay: string;
  earningPoints: number;
  eligibleProductIds: string[];
  expirationReminderDays: number;
  maxManualGrantPoints: number;
  pointsExpireAfterDays: number;
  programId: string;
  rewards: LoyaltyRewardDefinition[];
  saveAction: (formData: FormData) => Promise<void>;
  saveRewardAction: (formData: FormData) => Promise<void>;
  archiveRewardAction: (formData: FormData) => Promise<void>;
};

type EditorSection = "purchase" | "expiration" | "reward-create" | "reward-edit" | null;

function ModalShell({
  children,
  title,
  onClose,
}: {
  children: React.ReactNode;
  title: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a]/35 px-4 py-8">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-3xl rounded-2xl border border-[#d3dbe5] bg-white shadow-[0_18px_60px_rgba(15,23,42,0.2)]"
      >
        <div className="flex items-center justify-between border-b border-[#e2e8f0] px-6 py-5">
          <h2 className="text-2xl font-semibold text-[#1f2735]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-2xl leading-none text-[#1f2735] transition-opacity hover:opacity-70"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

export default function AdminLoyaltyCatalogEditor(props: LoyaltyCatalogEditorProps) {
  const [openSection, setOpenSection] = useState<EditorSection>(null);
  const [editingRewardId, setEditingRewardId] = useState<string | null>(null);
  const [earningPoints, setEarningPoints] = useState(String(props.earningPoints));
  const [earningAmountDisplay, setEarningAmountDisplay] = useState(props.earningAmountDisplay);
  const [pointsExpireAfterDays, setPointsExpireAfterDays] = useState(String(props.pointsExpireAfterDays));
  const [expirationReminderDays, setExpirationReminderDays] = useState(String(props.expirationReminderDays));
  const [maxManualGrantPoints, setMaxManualGrantPoints] = useState(String(props.maxManualGrantPoints));
  const [rewardName, setRewardName] = useState("");
  const [rewardPointsRequired, setRewardPointsRequired] = useState("");
  const [rewardAmountDisplay, setRewardAmountDisplay] = useState("");

  const activeRewards = props.rewards.filter((reward) => reward.isActive);
  const editingReward = editingRewardId
    ? props.rewards.find((reward) => reward.id === editingRewardId) ?? null
    : null;

  const commonHiddenFields = useMemo(
    () => (
      <>
        <input type="hidden" name="currencyCode" value={props.currencyCode} />
        <input type="hidden" name="isActive" value="on" />
        <input type="hidden" name="earningPoints" value={earningPoints} />
        <input type="hidden" name="earningAmountDisplay" value={earningAmountDisplay} />
        <input type="hidden" name="pointsExpireAfterDays" value={pointsExpireAfterDays} />
        <input type="hidden" name="expirationReminderDays" value={expirationReminderDays} />
        <input type="hidden" name="maxManualGrantPoints" value={maxManualGrantPoints} />
        {props.eligibleProductIds.map((productId) => (
          <input key={productId} type="hidden" name="eligibleProductIds" value={productId} />
        ))}
      </>
    ),
    [
      earningAmountDisplay,
      earningPoints,
      expirationReminderDays,
      maxManualGrantPoints,
      pointsExpireAfterDays,
      props.currencyCode,
      props.eligibleProductIds,
    ],
  );

  const openCreateReward = () => {
    setRewardName("");
    setRewardPointsRequired("");
    setRewardAmountDisplay("");
    setEditingRewardId(null);
    setOpenSection("reward-create");
  };

  const openEditReward = (reward: LoyaltyRewardDefinition) => {
    setRewardName(reward.name);
    setRewardPointsRequired(String(reward.pointsRequired));
    setRewardAmountDisplay((reward.amountMinor / 100).toFixed(2));
    setEditingRewardId(reward.id);
    setOpenSection("reward-edit");
  };

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-xl border border-[#d3dbe5] bg-white">
        <div className="border-b border-[#e2e8f0] px-5 py-4">
          <h2 className="text-lg font-semibold text-[#1f2735]">Points</h2>
          <p className="mt-1 text-sm text-[#4b5a72]">Manage the ways customers earn points.</p>
        </div>

        <div className="divide-y divide-[#e2e8f0]">
          <div className="flex items-start justify-between gap-4 px-5 py-5">
            <div className="max-w-3xl">
              <h3 className="text-base font-semibold text-[#1f2735]">Purchase a product</h3>
              <p className="mt-2 text-sm text-[#4b5a72]">
                Every {props.currencyCode} {earningAmountDisplay} spent gives {earningPoints} point{earningPoints === "1" ? "" : "s"}.
              </p>
              <p className="mt-1 text-sm text-[#4b5a72]">
                Loyalty points apply to eligible non-recurring catalog products only.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpenSection("purchase")}
              className="rounded-full border border-[#cbd5e1] px-4 py-2 text-sm font-medium text-[#1d3652] transition-colors hover:bg-[#f8fafc]"
            >
              Edit
            </button>
          </div>

          <div className="flex items-start justify-between gap-4 px-5 py-5">
            <div className="max-w-3xl">
              <h3 className="text-base font-semibold text-[#1f2735]">Points expiration</h3>
              <p className="mt-2 text-sm text-[#4b5a72]">
                100% of points expire after {pointsExpireAfterDays} days.
              </p>
              <p className="mt-1 text-sm text-[#4b5a72]">
                Expiration reminders go out {expirationReminderDays} days before expiry.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpenSection("expiration")}
              className="rounded-full border border-[#cbd5e1] px-4 py-2 text-sm font-medium text-[#1d3652] transition-colors hover:bg-[#f8fafc]"
            >
              Edit
            </button>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-[#d3dbe5] bg-white">
        <div className="flex items-center justify-between gap-4 border-b border-[#e2e8f0] px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-[#1f2735]">Rewards</h2>
            <p className="mt-1 text-sm text-[#4b5a72]">
              Reward definitions convert points into loyalty credit before checkout.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreateReward}
            className="rounded-full bg-[#1d3652] px-4 py-2 text-sm font-semibold text-white"
          >
            Add reward
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          <p className="text-sm text-[#4b5a72]">
            Manual grant ceiling: {maxManualGrantPoints} points.
          </p>

          {activeRewards.length > 0 ? (
            <div className="space-y-3">
              {activeRewards.map((reward) => (
                <article
                  key={reward.id}
                  className="flex items-start justify-between gap-4 rounded-xl border border-[#d3dbe5] bg-[#fbfcfe] p-4"
                >
                  <div>
                    <h3 className="text-base font-semibold text-[#1f2735]">{reward.name}</h3>
                    <p className="mt-1 text-sm text-[#4b5a72]">
                      {reward.pointsRequired} points = {props.currencyCode} {(reward.amountMinor / 100).toFixed(2)} loyalty credit
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => openEditReward(reward)}
                      className="rounded-full border border-[#cbd5e1] px-4 py-2 text-sm font-medium text-[#1d3652]"
                    >
                      Edit
                    </button>
                    <form action={props.archiveRewardAction}>
                      <input type="hidden" name="currencyCode" value={props.currencyCode} />
                      <input type="hidden" name="programId" value={props.programId} />
                      <input type="hidden" name="rewardDefinitionId" value={reward.id} />
                      <button
                        type="submit"
                        className="rounded-full border border-[#e2c5c5] px-4 py-2 text-sm font-medium text-[#8a2d2d]"
                      >
                        Archive
                      </button>
                    </form>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[#4b5a72]">No active reward definitions yet.</p>
          )}
        </div>
      </section>

      {openSection === "purchase" ? (
        <ModalShell title="Edit purchase earning" onClose={() => setOpenSection(null)}>
          <form action={props.saveAction} className="space-y-5">
            {commonHiddenFields}
            <div className="space-y-1 text-sm text-[#334155]">
              <label htmlFor="purchase-earning-points" className="font-medium">Points awarded</label>
              <input
                id="purchase-earning-points"
                type="number"
                min={1}
                value={earningPoints}
                onChange={(event) => setEarningPoints(event.currentTarget.value)}
                className="w-full rounded-md border border-[#cbd5e1] px-3 py-2"
              />
            </div>
            <div className="space-y-1 text-sm text-[#334155]">
              <label htmlFor="purchase-earning-amount" className="font-medium">Per spend amount ({props.currencyCode})</label>
              <input
                id="purchase-earning-amount"
                type="text"
                inputMode="decimal"
                value={earningAmountDisplay}
                onChange={(event) => setEarningAmountDisplay(event.currentTarget.value)}
                className="w-full rounded-md border border-[#cbd5e1] px-3 py-2"
              />
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setOpenSection(null)} className="rounded-full border border-[#cbd5e1] px-5 py-2 text-sm font-medium text-[#1f2735]">
                Cancel
              </button>
              <button type="submit" className="rounded-full bg-[#1d3652] px-5 py-2 text-sm font-semibold text-white">
                Save
              </button>
            </div>
          </form>
        </ModalShell>
      ) : null}

      {openSection === "expiration" ? (
        <ModalShell title="Edit points expiration" onClose={() => setOpenSection(null)}>
          <form action={props.saveAction} className="space-y-5">
            {commonHiddenFields}
            <div className="space-y-1 text-sm text-[#334155]">
              <label htmlFor="expiration-days" className="font-medium">Expire after days</label>
              <input
                id="expiration-days"
                type="number"
                min={1}
                value={pointsExpireAfterDays}
                onChange={(event) => setPointsExpireAfterDays(event.currentTarget.value)}
                className="w-full rounded-md border border-[#cbd5e1] px-3 py-2"
              />
            </div>
            <div className="space-y-1 text-sm text-[#334155]">
              <label htmlFor="expiration-reminder-days" className="font-medium">Reminder days before expiry</label>
              <input
                id="expiration-reminder-days"
                type="number"
                min={1}
                value={expirationReminderDays}
                onChange={(event) => setExpirationReminderDays(event.currentTarget.value)}
                className="w-full rounded-md border border-[#cbd5e1] px-3 py-2"
              />
            </div>
            <div className="space-y-1 text-sm text-[#334155]">
              <label htmlFor="max-manual-grant-points" className="font-medium">Max manual grant points</label>
              <input
                id="max-manual-grant-points"
                type="number"
                min={1}
                value={maxManualGrantPoints}
                onChange={(event) => setMaxManualGrantPoints(event.currentTarget.value)}
                className="w-full rounded-md border border-[#cbd5e1] px-3 py-2"
              />
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setOpenSection(null)} className="rounded-full border border-[#cbd5e1] px-5 py-2 text-sm font-medium text-[#1f2735]">
                Cancel
              </button>
              <button type="submit" className="rounded-full bg-[#1d3652] px-5 py-2 text-sm font-semibold text-white">
                Save
              </button>
            </div>
          </form>
        </ModalShell>
      ) : null}

      {openSection === "reward-create" || openSection === "reward-edit" ? (
        <ModalShell
          title={openSection === "reward-create" ? "Add reward" : "Edit reward"}
          onClose={() => {
            setOpenSection(null);
            setEditingRewardId(null);
          }}
        >
          <form action={props.saveRewardAction} className="space-y-5">
            <input type="hidden" name="currencyCode" value={props.currencyCode} />
            <input type="hidden" name="programId" value={props.programId} />
            <input type="hidden" name="rewardDefinitionId" value={editingReward?.id ?? ""} />
            <div className="space-y-1 text-sm text-[#334155]">
              <label htmlFor="reward-name" className="font-medium">Reward name</label>
              <input
                id="reward-name"
                name="name"
                type="text"
                value={rewardName}
                onChange={(event) => setRewardName(event.currentTarget.value)}
                className="w-full rounded-md border border-[#cbd5e1] px-3 py-2"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1 text-sm text-[#334155]">
                <label htmlFor="reward-points-required" className="font-medium">Points required</label>
                <input
                  id="reward-points-required"
                  name="pointsRequired"
                  type="number"
                  min={1}
                  value={rewardPointsRequired}
                  onChange={(event) => setRewardPointsRequired(event.currentTarget.value)}
                  className="w-full rounded-md border border-[#cbd5e1] px-3 py-2"
                />
              </div>
              <div className="space-y-1 text-sm text-[#334155]">
                <label htmlFor="reward-amount" className="font-medium">Reward amount ({props.currencyCode})</label>
                <input
                  id="reward-amount"
                  name="amountDisplay"
                  type="text"
                  inputMode="decimal"
                  value={rewardAmountDisplay}
                  onChange={(event) => setRewardAmountDisplay(event.currentTarget.value)}
                  className="w-full rounded-md border border-[#cbd5e1] px-3 py-2"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setOpenSection(null)} className="rounded-full border border-[#cbd5e1] px-5 py-2 text-sm font-medium text-[#1f2735]">
                Cancel
              </button>
              <button type="submit" className="rounded-full bg-[#1d3652] px-5 py-2 text-sm font-semibold text-white">
                Save
              </button>
            </div>
          </form>
        </ModalShell>
      ) : null}
    </div>
  );
}
