"use client";

export default function WalletError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="space-y-4">
      <h1 className="text-3xl font-semibold text-[#6f2b2b]">Gift Card Wallet</h1>
      <div className="rounded-xl border border-[#f0cece] bg-white p-5">
        <p className="text-sm text-[#7b2d2d]">
          Something went wrong loading your wallet. Please try again.
        </p>
        {process.env.NODE_ENV !== "production" && error.message ? (
          <pre className="mt-2 text-xs text-[#8a5959] whitespace-pre-wrap">{error.message}</pre>
        ) : null}
        <button
          type="button"
          onClick={reset}
          className="mt-3 rounded-lg bg-[#7b2d2d] px-4 py-2 text-sm font-medium text-white hover:bg-[#6f2b2b]"
        >
          Try again
        </button>
      </div>
    </section>
  );
}
