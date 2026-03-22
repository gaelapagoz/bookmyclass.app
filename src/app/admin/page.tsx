import Image from "next/image";
import Link from "next/link";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";

import { auth, signIn } from "@/auth";
import { isAdminRole } from "@/lib/auth/admin-access";

type SearchParams = Promise<{
  callbackUrl?: string;
  error?: string;
}>;

export async function adminSignInAction(formData: FormData) {
  "use server";

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const callbackUrl = String(formData.get("callbackUrl") ?? "/admin/dashboard");

  if (!email || !password) {
    redirect(`/admin?error=invalid_input&callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }

  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: callbackUrl || "/admin/dashboard",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      redirect(`/admin?error=invalid_credentials&callbackUrl=${encodeURIComponent(callbackUrl)}`);
    }
    throw error;
  }
}

function getErrorMessage(error?: string) {
  if (!error) {
    return null;
  }

  if (error === "invalid_input") {
    return "Please enter your email and password.";
  }

  if (error === "invalid_credentials" || error === "CredentialsSignin") {
    return "Invalid email or password.";
  }

  if (error === "unauthorized") {
    return "Your account does not have admin access.";
  }

  return "Could not sign in right now. Please try again.";
}

export default async function AdminEntryPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await auth();

  if (session?.user && isAdminRole(session.user.role)) {
    redirect("/admin/dashboard");
  }

  const { callbackUrl = "/admin/dashboard", error } = await searchParams;
  const errorMessage = getErrorMessage(error);

  const isNonAdminUser = Boolean(session?.user) && !isAdminRole(session.user?.role);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f2ede7] px-4 py-10 text-[#4f2a2a]">
      <div className="w-full max-w-md rounded-2xl border border-[#d8cec6] bg-white p-6 shadow-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <Image
            src="/images/logo.png"
            alt="Yoga Pilates Fitness Studio logo"
            width={96}
            height={96}
            className="h-24 w-24 rounded-full object-cover"
            priority
          />
          <p className="mt-4 text-xs uppercase tracking-[0.18em] text-[#8a5959]">Admin Portal</p>
          <h1 className="mt-1 text-2xl font-semibold text-[#6f2b2b]">Yoga Pilates Fitness Studio</h1>
        </div>

        {isNonAdminUser ? (
          <div className="space-y-4 rounded-xl border border-[#e4d8cf] bg-[#f9f5f1] p-4">
            <p className="text-sm text-[#7b2d2d]">Your account is signed in but does not have admin access.</p>
            <div className="flex gap-3">
              <Link href="/" className="rounded-md bg-[#7b2d2d] px-4 py-2 text-sm text-[#f4eee8] hover:opacity-90">
                Back to Site
              </Link>
            </div>
          </div>
        ) : (
          <>
            {errorMessage ? <p className="mb-4 text-sm text-[#7b2d2d]">{errorMessage}</p> : null}

            <form action={adminSignInAction} className="space-y-4 rounded-xl border border-[#d8cec6] bg-[#fffdfb] p-5">
              <input type="hidden" name="callbackUrl" value={callbackUrl} />

              <label className="block text-sm text-[#5f4040]">
                Email
                <input
                  name="email"
                  type="email"
                  required
                  className="mt-1 w-full rounded-md border border-[#d8cec6] px-3 py-2"
                />
              </label>

              <label className="block text-sm text-[#5f4040]">
                Password
                <input
                  name="password"
                  type="password"
                  required
                  className="mt-1 w-full rounded-md border border-[#d8cec6] px-3 py-2"
                />
              </label>

              <button
                type="submit"
                className="w-full rounded-md bg-[#7b2d2d] px-4 py-2 text-sm text-[#f4eee8] hover:opacity-90"
              >
                Sign In to Admin
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}


