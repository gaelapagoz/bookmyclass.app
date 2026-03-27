import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export async function requireAuth() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/sign-in?callbackUrl=%2Fdashboard");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { email: true, emailVerified: true },
  });

  if (!user) {
    redirect("/auth/stale-session?callbackUrl=%2Fdashboard");
  }

  if (!user.emailVerified) {
    redirect(`/verify-email?blocked=1&email=${encodeURIComponent(user.email)}`);
  }

  return session;
}
