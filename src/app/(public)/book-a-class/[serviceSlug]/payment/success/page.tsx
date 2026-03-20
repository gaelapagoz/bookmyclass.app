import Link from "next/link";

export default async function BookingPaymentSuccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ serviceSlug: string }>;
  searchParams: Promise<{ bookingId?: string }>;
}) {
  const { serviceSlug } = await params;
  const { bookingId } = await searchParams;

  return (
    <section className="mx-auto w-full max-w-3xl px-6 py-14">
      <h1 className="text-3xl font-semibold text-[#6f2b2b]">Payment Received</h1>
      <p className="mt-3 text-sm text-[#7f5a5a]">
        Stripe returned successfully. Final booking confirmation is processed by webhook and may take a few
        seconds.
      </p>
      <p className="mt-3 text-sm text-[#5f4040]">Booking ID: {bookingId ?? "Unavailable"}</p>

      <div className="mt-6 flex items-center gap-4">
        <Link
          href={`/book-a-class/${serviceSlug}/payment?bookingId=${bookingId ?? ""}`}
          className="text-sm font-medium text-[#7b2d2d] underline underline-offset-4 hover:opacity-80"
        >
          Back to payment status
        </Link>
        <Link
          href={`/book-a-class/${serviceSlug}`}
          className="text-sm font-medium text-[#7b2d2d] underline underline-offset-4 hover:opacity-80"
        >
          Back to service
        </Link>
      </div>
    </section>
  );
}
