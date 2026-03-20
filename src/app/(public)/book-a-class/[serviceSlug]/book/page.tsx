import Link from "next/link";

export default async function BookingFormPlaceholderPage({
  params,
  searchParams,
}: {
  params: Promise<{ serviceSlug: string }>;
  searchParams: Promise<{ sessionId?: string }>;
}) {
  const { serviceSlug } = await params;
  const { sessionId } = await searchParams;

  return (
    <section className="mx-auto w-full max-w-3xl px-6 py-14">
      <h1 className="text-3xl font-semibold text-[#6f2b2b]">Booking Form (Next Block)</h1>
      <p className="mt-3 text-sm text-[#7f5a5a]">
        The booking creation form and checkout are connected in the next implementation block.
      </p>
      <dl className="mt-6 space-y-2 rounded-lg border border-[#d8cec6] bg-white p-4 text-sm text-[#5f4040]">
        <div className="flex gap-2">
          <dt className="font-semibold">Service:</dt>
          <dd>{serviceSlug}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-semibold">Session:</dt>
          <dd>{sessionId ?? "Not selected"}</dd>
        </div>
      </dl>
      <Link
        href={`/book-a-class/${serviceSlug}`}
        className="mt-6 inline-block text-sm font-medium text-[#7b2d2d] underline underline-offset-4 hover:opacity-80"
      >
        Back to availability
      </Link>
    </section>
  );
}
