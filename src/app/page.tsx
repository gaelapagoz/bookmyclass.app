import Link from "next/link";

import { auth, signIn, signOut } from "@/auth";

export default async function Home() {
  const session = await auth();
  const email = session?.user?.email;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold">Authentication Foundation</h1>
      <p className="text-sm text-zinc-600">
        {email ? `Signed in as ${email}` : "You are not signed in."}
      </p>

      <div className="flex gap-3">
        <Link
          href="/dashboard"
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm"
        >
          Go to protected dashboard
        </Link>

        {session?.user ? (
          <form
            action={async () => {
              "use server";
              await signOut();
            }}
          >
            <button
              type="submit"
              className="rounded-md bg-black px-4 py-2 text-sm text-white"
            >
              Sign out
            </button>
          </form>
        ) : (
          <form
            action={async () => {
              "use server";
              await signIn();
            }}
          >
            <button
              type="submit"
              className="rounded-md bg-black px-4 py-2 text-sm text-white"
            >
              Sign in
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
