import { auth, signOut } from "@/auth";
import { unstable_noStore as noStore } from "next/cache";
import NavbarClient from "@/components/NavbarClient";

export default async function Navbar() {
  noStore();
  const session = await auth();

  async function handleSignOut(_formData: FormData) {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <NavbarClient
      isAuthenticated={Boolean(session?.user)}
      onSignOutAction={handleSignOut}
    />
  );
}
