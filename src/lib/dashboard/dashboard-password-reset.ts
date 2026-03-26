import { requestPasswordReset } from "@/lib/auth/password-service";
import { getDashboardProfileData } from "@/lib/dashboard/dashboard-service";

export async function requestDashboardPasswordResetByUserId(input: {
  userId: string;
  appUrl?: string;
}): Promise<void> {
  const profile = await getDashboardProfileData(input.userId);
  await requestPasswordReset({
    email: profile.email,
    appUrl: input.appUrl,
  });
}
