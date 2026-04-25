export class AuthError extends Error {
  type: string;

  constructor(type: string) {
    super(type);
    this.type = type;
    this.name = "AuthError";
  }
}

type NextAuthResult = {
  handlers: {
    GET: (...args: unknown[]) => Promise<Response>;
    POST: (...args: unknown[]) => Promise<Response>;
  };
  auth: () => Promise<unknown>;
  signIn: (...args: unknown[]) => Promise<unknown>;
  signOut: (...args: unknown[]) => Promise<unknown>;
};

export default function NextAuth(): NextAuthResult {
  const notImplemented = async () => {
    throw new Error("next-auth stub called in tests; mock the auth layer explicitly.");
  };

  return {
    handlers: {
      GET: notImplemented,
      POST: notImplemented,
    },
    auth: async () => null,
    signIn: notImplemented,
    signOut: notImplemented,
  };
}

