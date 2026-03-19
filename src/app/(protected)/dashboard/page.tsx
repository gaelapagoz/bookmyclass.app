import { auth, signOut } from "@/auth";

export default async function DashboardPage() {
  const session = await auth();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold">Protected Dashboard</h1>
      <p className="text-sm text-zinc-600">
        Signed in as: {session?.user?.email ?? "unknown"}
      </p>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/" });
        }}
      >
        <button
          type="submit"
          className="w-fit rounded-md bg-black px-4 py-2 text-sm text-white"
        >
          Sign out
        </button>
      </form>
    </main>
  );
}
