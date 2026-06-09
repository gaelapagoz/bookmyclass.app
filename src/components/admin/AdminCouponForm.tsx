"use client";

import { CouponDiscountType, CouponStatus } from "@prisma/client";
import { useState } from "react";

type AdminCouponFormValues = {
  couponId?: string;
  name: string;
  code: string;
  status: CouponStatus;
  description: string;
  discountType: CouponDiscountType;
  discountValue: string;
  validFrom: string;
  validUntil: string;
  maxTotalRedemptions: string;
  maxRedemptionsPerClient: string;
};

type AdminCouponFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  initialValues: AdminCouponFormValues;
  submitLabel: string;
  archived?: boolean;
};

type EditableCouponStatus = "ACTIVE" | "INACTIVE";

const fieldClassName =
  "mt-2 w-full rounded-lg border border-[#d3dbe5] bg-white px-3 py-2.5 text-sm text-[#1f2735] outline-none transition focus:border-[#8ab6de] focus:ring-2 focus:ring-[#d9e9f7]";

export function AdminCouponForm({
  action,
  initialValues,
  submitLabel,
  archived = false,
}: AdminCouponFormProps) {
  const [discountType, setDiscountType] = useState(initialValues.discountType);
  const [status, setStatus] = useState<EditableCouponStatus>(
    initialValues.status === CouponStatus.ARCHIVED ? CouponStatus.INACTIVE : initialValues.status,
  );

  const discountValueLabel =
    discountType === CouponDiscountType.FIXED_AMOUNT ? "Discount value (EUR)" : "Discount value (%)";

  return (
    <form action={action} className="space-y-5">
      {initialValues.couponId ? <input type="hidden" name="couponId" value={initialValues.couponId} /> : null}
      <input type="hidden" name="status" value={status} />
      <input
        type="hidden"
        name="currencyCode"
        value={discountType === CouponDiscountType.FIXED_AMOUNT ? "EUR" : ""}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <label className="block text-sm font-semibold text-[#1f2735]">
          Coupon name
          <input name="name" defaultValue={initialValues.name} className={fieldClassName} />
        </label>

        <label className="block text-sm font-semibold text-[#1f2735]">
          Coupon code
          <input name="code" defaultValue={initialValues.code} className={fieldClassName} required />
        </label>

        <label className="block text-sm font-semibold text-[#1f2735]">
          Status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as EditableCouponStatus)}
            className={fieldClassName}
          >
            <option value={CouponStatus.ACTIVE}>Active</option>
            <option value={CouponStatus.INACTIVE}>Inactive</option>
          </select>
        </label>
      </div>

      <label className="block text-sm font-semibold text-[#1f2735]">
        Description
        <textarea
          name="description"
          defaultValue={initialValues.description}
          className={`${fieldClassName} min-h-28 resize-y`}
        />
      </label>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block text-sm font-semibold text-[#1f2735]">
          Discount type
          <select
            name="discountType"
            value={discountType}
            onChange={(event) => setDiscountType(event.target.value as CouponDiscountType)}
            className={fieldClassName}
          >
            <option value={CouponDiscountType.PERCENTAGE}>Percentage</option>
            <option value={CouponDiscountType.FIXED_AMOUNT}>Amount</option>
          </select>
        </label>

        <label className="block text-sm font-semibold text-[#1f2735]">
          {discountValueLabel}
          <input
            name="discountValue"
            defaultValue={initialValues.discountValue}
            className={fieldClassName}
            inputMode="decimal"
            required
          />
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block text-sm font-semibold text-[#1f2735]">
          Valid from
          <input name="validFrom" type="date" defaultValue={initialValues.validFrom} className={fieldClassName} />
        </label>

        <label className="block text-sm font-semibold text-[#1f2735]">
          Valid until
          <input name="validUntil" type="date" defaultValue={initialValues.validUntil} className={fieldClassName} required />
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block text-sm font-semibold text-[#1f2735]">
          Maximum total redemptions
          <input
            name="maxTotalRedemptions"
            type="number"
            min="1"
            defaultValue={initialValues.maxTotalRedemptions}
            className={fieldClassName}
          />
        </label>

        <label className="block text-sm font-semibold text-[#1f2735]">
          Maximum redemptions per client
          <input
            name="maxRedemptionsPerClient"
            type="number"
            min="1"
            defaultValue={initialValues.maxRedemptionsPerClient}
            className={fieldClassName}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          className="rounded-md bg-[#1d3652] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#162a41]"
        >
          {submitLabel}
        </button>
        {archived ? <span className="text-xs font-medium text-[#7b5e17]">Archived coupon</span> : null}
      </div>
    </form>
  );
}
