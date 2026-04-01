"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        <main className="mx-auto max-w-2xl px-6 py-20">
          <h1 className="text-2xl font-semibold text-[#1f2735]">Something went wrong</h1>
          <p className="mt-2 text-sm text-[#4b5a72]">
            We logged this error and will investigate it.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            className="mt-5 rounded-md bg-[#1d3652] px-4 py-2 text-sm text-white"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
