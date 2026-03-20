import Link from "next/link";
import { auth } from "../../../../../auth";
import { BookingDraftForm } from "../../../../../components/book-a-class/service-detail/BookingDraftForm";
import { prisma } from "../../../../../lib/db";
import { getBookingSessionSummary } from "../../../../../lib/public-booking/booking-draft-service";

export default async function BookingFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ serviceSlug: string }>;
  searchParams: Promise<{ sessionId?: string }>;
}) {
  const { serviceSlug } = await params;
  const { sessionId } = await searchParams;
  const session = await auth();

  const user = session?.user?.id
    ? await prisma.user.findUnique({
        where: { id: session.user.id },
        select: {
          name: true,
          email: true,
          clientProfile: {
            select: {
              phone: true,
            },
          },
        },
      })
    : null;

  if (!sessionId) {
    return (
      <section className="mx-auto w-full max-w-3xl px-6 py-14">
        <h1 className="text-3xl font-semibold text-[#6f2b2b]">Booking Form</h1>
        <p className="mt-3 text-sm text-[#7b2d2d]">Missing sessionId. Please choose a slot first.</p>
        <Link
          href={`/book-a-class/${serviceSlug}`}
          className="mt-6 inline-block text-sm font-medium text-[#7b2d2d] underline underline-offset-4 hover:opacity-80"
        >
          Back to availability
        </Link>
      </section>
    );
  }

  const summary = await getBookingSessionSummary({
    serviceSlug,
    sessionId,
  });

  if (!summary) {
    return (
      <section className="mx-auto w-full max-w-3xl px-6 py-14">
        <h1 className="text-3xl font-semibold text-[#6f2b2b]">Booking Form</h1>
        <p className="mt-3 text-sm text-[#7b2d2d]">
          The selected session is invalid, full, or no longer available.
        </p>
        <Link
          href={`/book-a-class/${serviceSlug}`}
          className="mt-6 inline-block text-sm font-medium text-[#7b2d2d] underline underline-offset-4 hover:opacity-80"
        >
          Back to availability
        </Link>
      </section>
    );
  }

  return (
    <BookingDraftForm
      session={summary}
      isAuthenticated={Boolean(session?.user)}
      initialValues={{
        customerName: user?.name ?? "",
        customerEmail: user?.email ?? "",
        customerPhone: user?.clientProfile?.phone ?? "",
      }}
    />
  );
}
