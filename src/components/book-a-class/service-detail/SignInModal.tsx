"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useState } from "react";
import type { FormEvent } from "react";
import { runAsyncWithCursor } from "@/lib/ui/async-loading";

type SignInModalProps = {
  onClose: () => void;
  onSuccess: (targetHref: string) => void;
  targetHref: string;
};

export function SignInModal({ onClose, onSuccess, targetHref }: SignInModalProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    await runAsyncWithCursor(async () => {
      setIsSubmitting(true);
      try {
        const result = await signIn("credentials", {
          email: email.trim().toLowerCase(),
          password,
          redirect: false,
        });

        if (!result || result.error) {
          setErrorMessage("Invalid email or password.");
          return;
        }

        onSuccess(targetHref);
      } catch {
        setErrorMessage("Could not sign in right now. Please try again.");
      } finally {
        setIsSubmitting(false);
      }
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4" role="dialog" aria-modal="true" aria-label="Sign in to continue booking">
      <div className="w-full max-w-md rounded-xl border border-[#d8cec6] bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-[#6f2b2b]">Sign In</h2>
            <p className="mt-1 text-sm text-[#7f5a5a]">
              Sign in to continue with this booking.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-[#7b2d2d] hover:bg-[#f2ede7]"
            aria-label="Close sign in modal"
          >
            Close
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <label className="block text-sm text-[#5f4040]">
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 w-full rounded-md border border-[#d8cec6] px-3 py-2"
            />
          </label>

          <label className="block text-sm text-[#5f4040]">
            Password
            <input
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded-md border border-[#d8cec6] px-3 py-2"
            />
          </label>

          {errorMessage ? <p className="text-sm text-[#7b2d2d]">{errorMessage}</p> : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center rounded-md bg-[#7b2d2d] px-4 py-2 text-sm text-[#f4eee8] disabled:opacity-60"
          >
            {isSubmitting ? (
              <>
                <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
                Signing in...
              </>
            ) : (
              "Sign In And Continue"
            )}
          </button>
        </form>

        <p className="mt-4 text-sm text-[#7f5a5a]">
          New here?{" "}
          <Link
            href={`/sign-up?callbackUrl=${encodeURIComponent(targetHref)}`}
            className="font-medium text-[#7b2d2d] underline underline-offset-4"
            onClick={onClose}
          >
            Create account
          </Link>
        </p>
      </div>
    </div>
  );
}
