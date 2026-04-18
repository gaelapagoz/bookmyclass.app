export function getSessionWaitlistLabel(waitlistCount: number): string | null {
  if (waitlistCount <= 0) {
    return null;
  }

  return `Waitlist: ${waitlistCount}`;
}
