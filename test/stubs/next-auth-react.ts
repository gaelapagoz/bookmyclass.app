export async function signOut(_options?: unknown): Promise<void> {
  // no-op in tests
}

export async function signIn(_provider?: unknown, _options?: unknown): Promise<void> {
  // no-op in tests
}

export function useSession() {
  return { data: null, status: "unauthenticated" as const };
}
