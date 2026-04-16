import { redirect } from "next/navigation";
import { requireStaffSession } from "@/lib/auth/require-auth";
import { verifyPasswordForKioskExit } from "@/lib/auth/kiosk-exit-auth";

export default async function KioskExitPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }> | { error?: string };
}) {
  await requireStaffSession({
    callbackUrl: "/kiosk/exit",
    unauthorizedPath: "/sign-in",
  });
  const resolvedSearchParams = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f7f3ee] px-4">
      <div className="w-full max-w-md rounded-xl border border-[#d8cec6] bg-white p-8 shadow-lg">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold text-[#1f2735]">Exit Kiosk Mode</h1>
          <p className="mt-2 text-sm text-[#4b5a72]">
            Please confirm your password to exit kiosk mode
          </p>
        </div>

        <form action={handleKioskExit} className="space-y-4" data-testid="kiosk-exit-form">
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-[#1f2735]">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              data-testid="kiosk-exit-password"
              className="mt-1 block w-full rounded-md border border-[#d3dbe5] px-3 py-2 shadow-sm focus:border-[#7b2d2d] focus:outline-none focus:ring-1 focus:ring-[#7b2d2d]"
              placeholder="Enter your password"
            />
          </div>

          {resolvedSearchParams.error && (
            <div className="rounded-md bg-red-50 p-3">
              <p className="text-sm text-red-700">
                {resolvedSearchParams.error === "invalid_password"
                  ? "Invalid password. Please try again."
                  : resolvedSearchParams.error === "rate_limited"
                  ? "Too many attempts. Please wait 30 minutes before trying again."
                  : "An error occurred. Please try again."}
              </p>
            </div>
          )}

          <div className="flex space-x-3">
            <a
              href="/kiosk"
              className="flex-1 rounded-md border border-[#d3dbe5] bg-white px-4 py-2 text-center text-sm font-medium text-[#4b5a72] transition-colors hover:bg-[#f9f7f4] focus:outline-none focus:ring-2 focus:ring-[#7b2d2d] focus:ring-offset-2"
            >
              Cancel
            </a>
            <button
              type="submit"
              data-testid="kiosk-exit-submit"
              className="flex-1 rounded-md bg-[#7b2d2d] px-4 py-2 text-sm font-medium text-[#f4eee8] transition-colors hover:bg-[#5a1f1f] focus:outline-none focus:ring-2 focus:ring-[#7b2d2d] focus:ring-offset-2"
            >
              Exit Kiosk
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

async function handleKioskExit(formData: FormData) {
  "use server";

  const session = await requireStaffSession({
    callbackUrl: "/kiosk/exit",
    unauthorizedPath: "/sign-in",
    throwOnFailure: true,
  });

  const password = formData.get("password") as string;

  if (!password) {
    redirect("/kiosk/exit?error=invalid_password");
  }

  let isValid = false;
  try {
    isValid = await verifyPasswordForKioskExit(password);
  } catch (error) {
    if (error instanceof Error && error.message === "RATE_LIMITED") {
      redirect("/kiosk/exit?error=rate_limited");
    }
    console.error("Kiosk exit error:", error);
    redirect("/kiosk/exit?error=server_error");
  }

  if (!isValid) {
    redirect("/kiosk/exit?error=invalid_password");
  }

  const redirectTarget = session.user.role === "TEACHER" ? "/teacher" : "/admin";
  redirect(redirectTarget);
}
