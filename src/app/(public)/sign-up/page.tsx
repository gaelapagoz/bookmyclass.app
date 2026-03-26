import { AuthError } from "next-auth";
import { auth, signIn } from "@/auth";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { hashPassword } from "@/lib/auth/password-service";
import { getSafeCallbackPath } from "@/lib/auth/safe-callback-url";
import Link from "next/link";
import { redirect } from "next/navigation";

type SearchParams = Promise<{
  callbackUrl?: string;
  error?: string;
}>;

function parseName(firstName: string, lastName: string) {
  return `${firstName.trim()} ${lastName.trim()}`.trim();
}

function isPrismaKnownError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError;
}

function isNextRedirectError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

export async function registerAction(formData: FormData) {
  "use server";

  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const callbackUrl = getSafeCallbackPath(formData.get("callbackUrl"), "/dashboard");

  if (!firstName || !lastName || !email || !password || password.length < 8) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[sign-up] validation failed", {
        hasFirstName: Boolean(firstName),
        hasLastName: Boolean(lastName),
        hasEmail: Boolean(email),
        passwordLength: password.length,
      });
    }
    redirect(`/sign-up?error=invalid_input&callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }

  const existingUser = await prisma.user.findFirst({
    where: {
      email: {
        equals: email,
        mode: "insensitive",
      },
    },
    select: { id: true },
  });

  if (existingUser) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[sign-up] duplicate email (pre-check)", { email });
    }
    redirect(`/sign-up?error=email_exists&callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }

  const passwordHash = await hashPassword(password);
  const baseData = {
    name: parseName(firstName, lastName),
    email,
    passwordHash,
    role: "CLIENT" as const,
    isActive: true,
    isInactive: false,
  };

  try {
    const createdUser = await prisma.user.create({
      data: {
        ...baseData,
        firstName,
        lastName,
      },
      select: { id: true, email: true },
    });
    if (process.env.NODE_ENV !== "production") {
      console.info("[sign-up] user created", createdUser);
    }
  } catch (error: unknown) {
    if (isPrismaKnownError(error) && error.code === "P2002") {
      if (process.env.NODE_ENV !== "production") {
        console.error("[sign-up] duplicate email (P2002)", { email, code: error.code });
      }
      redirect(`/sign-up?error=email_exists&callbackUrl=${encodeURIComponent(callbackUrl)}`);
    }

    if (process.env.NODE_ENV !== "production") {
      console.error("[sign-up] user.create failed", error);
    }

    redirect(`/sign-up?error=signup_failed&callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }

  try {
    if (process.env.NODE_ENV !== "production") {
      console.info("[sign-up] attempting auto sign-in", { email });
      console.info("[sign-up] redirect success path", { redirectTo: callbackUrl });
    }

    await signIn("credentials", {
      email,
      password,
      redirectTo: callbackUrl,
    });
  } catch (error: unknown) {
    if (isNextRedirectError(error)) {
      throw error;
    }

    if (process.env.NODE_ENV !== "production") {
      console.error("[sign-up] auto sign-in failed", error);
    }

    if (error instanceof AuthError) {
      redirect(`/sign-up?error=signin_failed&callbackUrl=${encodeURIComponent(callbackUrl)}`);
    }

    if (process.env.NODE_ENV !== "production") {
      console.error("[sign-up] unexpected sign-in error", error);
    }

    redirect(`/sign-up?error=signup_failed&callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }
}

function getErrorMessage(error?: string) {
  if (!error) {
    return null;
  }

  if (error === "email_exists") {
    return "An account with this email already exists.";
  }

  if (error === "invalid_input") {
    return "Please fill all fields correctly. Password must be at least 8 characters.";
  }

  if (error === "signup_failed") {
    return "Could not create account right now. Please try again.";
  }

  if (error === "signin_failed") {
    return "Account created, but automatic sign-in failed. Please sign in manually.";
  }

  return "Could not create account.";
}

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  const { error, callbackUrl: rawCallbackUrl = "/dashboard" } = await searchParams;
  const callbackUrl = getSafeCallbackPath(rawCallbackUrl, "/dashboard");
  if (session?.user) {
    redirect(callbackUrl);
  }

  const errorMessage = getErrorMessage(error);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col px-6 py-16">
      <h1 className="text-3xl font-semibold text-[#6f2b2b]">Sign Up</h1>
      <p className="mt-2 text-sm text-[#7f5a5a]">Create your account to access your dashboard.</p>

      {errorMessage ? <p className="mt-4 text-sm text-[#7b2d2d]">{errorMessage}</p> : null}

      <form action={registerAction} className="mt-8 space-y-4 rounded-xl border border-[#d8cec6] bg-white p-5">
        <input type="hidden" name="callbackUrl" value={callbackUrl} />

        <label className="block text-sm text-[#5f4040]">
          First name
          <input
            name="firstName"
            required
            className="mt-1 w-full rounded-md border border-[#d8cec6] px-3 py-2"
          />
        </label>

        <label className="block text-sm text-[#5f4040]">
          Last name
          <input
            name="lastName"
            required
            className="mt-1 w-full rounded-md border border-[#d8cec6] px-3 py-2"
          />
        </label>

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
            minLength={8}
            required
            className="mt-1 w-full rounded-md border border-[#d8cec6] px-3 py-2"
          />
        </label>

        <button
          type="submit"
          className="rounded-md bg-[#7b2d2d] px-4 py-2 text-sm text-[#f4eee8] hover:opacity-90"
        >
          Create Account
        </button>
      </form>

      <p className="mt-4 text-sm text-[#7f5a5a]">
        Already have an account?{" "}
        <Link
          href={`/sign-in?callbackUrl=${encodeURIComponent(callbackUrl)}`}
          className="font-medium text-[#7b2d2d] underline underline-offset-4"
        >
          Sign in
        </Link>
      </p>
    </main>
  );
}

