import Link from "next/link";
import { BookingPaymentOptionsStep } from "../../../../../components/book-a-class/service-detail/BookingPaymentOptionsStep";

export default async function BookingPaymentOptionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ serviceSlug: string }>;
  searchParams: Promise<{ bookingId?: string }>;
}) {
  const { serviceSlug } = await params;
  const { bookingId } = await searchParams;

  if (!bookingId) {
    return (
      <section className="mx-auto w-full max-w-3xl px-6 py-14">
        <h1 className="text-3xl font-semibold text-[#6f2b2b]">Choose Payment Option</h1>
        <p className="mt-3 text-sm text-[#7b2d2d]">Missing bookingId. Please create your booking draft first.</p>
        <Link
          href={`/book-a-class/${serviceSlug}`}
          className="mt-6 inline-block text-sm font-medium text-[#7b2d2d] underline underline-offset-4 hover:opacity-80"
        >
          Back to availability
        </Link>
      </section>
    );
  }

  return <BookingPaymentOptionsStep bookingId={bookingId} serviceSlug={serviceSlug} />;
}
