import { auth, signOut } from "@/auth";
import { unstable_noStore as noStore } from "next/cache";
import NavbarClient from "@/components/NavbarClient";
import { getVerifiedCustomerState } from "@/lib/auth/verified-customer-state";

export default async function Navbar() {
  noStore();
  const session = await auth();
  const customerState = await getVerifiedCustomerState(session);

  async function handleSignOut(_formData: FormData) {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <NavbarClient
      isAuthenticated={customerState.kind === "verified"}
      onSignOutAction={handleSignOut}
    />
  );
}
