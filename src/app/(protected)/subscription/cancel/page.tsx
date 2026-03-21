import Link from "next/link";

export default async function SubscriptionCancelPage({
  searchParams,
}: {
  searchParams: Promise<{ productId?: string }>;
}) {
  const { productId } = await searchParams;

  return (
    <section className="mx-auto w-full max-w-3xl px-6 py-14">
      <h1 className="text-3xl font-semibold text-[#6f2b2b]">Checkout Cancelled</h1>
      <p className="mt-3 text-sm text-[#7f5a5a]">
        You cancelled Stripe checkout. No product purchase changes were applied.
      </p>
      {productId ? <p className="mt-3 text-sm text-[#5f4040]">Product ID: {productId}</p> : null}

      <div className="mt-6 flex items-center gap-4">
        <Link
          href="/subscription"
          className="text-sm font-medium text-[#7b2d2d] underline underline-offset-4 hover:opacity-80"
        >
          Try again
        </Link>
        <Link
          href="/dashboard"
          className="text-sm font-medium text-[#7b2d2d] underline underline-offset-4 hover:opacity-80"
        >
          Back to dashboard
        </Link>
      </div>
    </section>
  );
}
