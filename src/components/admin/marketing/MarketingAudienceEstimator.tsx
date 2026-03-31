type Props = {
  totalResolved: number;
  totalAfterUnsubscribe: number;
};

export default function MarketingAudienceEstimator({ totalResolved, totalAfterUnsubscribe }: Props) {
  return (
    <section className="rounded-xl border border-[#d3dbe5] bg-white p-4">
      <h3 className="text-base font-semibold text-[#1f2735]">Audience estimate</h3>
      <p className="mt-2 text-sm text-[#4b5a72]">Resolved recipients: {totalResolved}</p>
      <p className="text-sm text-[#4b5a72]">After unsubscribe exclusion: {totalAfterUnsubscribe}</p>
    </section>
  );
}
