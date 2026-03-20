import Link from "next/link";

export default async function BookingPaymentCancelPage({
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
      <h1 className="text-3xl font-semibold text-[#6f2b2b]">Checkout Cancelled</h1>
      <p className="mt-3 text-sm text-[#7f5a5a]">
        No payment was confirmed. Your booking draft remains pending and you can retry checkout.
      </p>
      <p className="mt-3 text-sm text-[#5f4040]">Booking ID: {bookingId ?? "Unavailable"}</p>

      <Link
        href={`/book-a-class/${serviceSlug}/payment?bookingId=${bookingId ?? ""}`}
        className="mt-6 inline-block text-sm font-medium text-[#7b2d2d] underline underline-offset-4 hover:opacity-80"
      >
        Retry payment
      </Link>
    </section>
  );
}
