import NextAuth from "next-auth";
import type { Role } from "@prisma/client";
import Credentials from "next-auth/providers/credentials";

import { authorizeCredentials, type AuthUser } from "@/lib/auth/credentials-authorize";
import { prisma } from "@/lib/db";
import { createPerfTrace } from "@/lib/monitoring/perf-trace";
import { createInMemoryTtlCache } from "@/lib/cache/in-memory-ttl-cache";

const ROLES: Role[] = ["MASTER_ADMIN", "ADMIN", "TEACHER", "CLIENT"];
const SESSION_USER_CACHE_TTL_MS = 300_000;
const jwtTokenUserCache = createInMemoryTtlCache<{ id: string; role: Role } | null>({
  defaultTtlMs: SESSION_USER_CACHE_TTL_MS,
});

function isRole(value: unknown): value is Role {
  return typeof value === "string" && ROLES.includes(value as Role);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: process.env.AUTH_SECRET,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/sign-in",
  },
  providers: [
    Credentials({
      name: "Email and Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: authorizeCredentials,
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as AuthUser).id;
        token.role = (user as AuthUser).role;
      }

      if ((!token.id || !token.role) && token.sub) {
        const trace = createPerfTrace("auth.jwt.resolveTokenUser", {
          hasTokenId: Boolean(token.id),
          hasTokenRole: Boolean(token.role),
          tokenSub: token.sub,
        });
        let foundUser = false;
        try {
          const dbUser = await jwtTokenUserCache.getOrLoad(
            token.sub,
            () =>
              trace.db("user.findUnique.jwtTokenResolve", () =>
                prisma.user.findUnique({
                  where: { id: token.sub },
                  select: { id: true, role: true },
                }),
              ),
            SESSION_USER_CACHE_TTL_MS,
          );

          if (dbUser) {
            token.id = dbUser.id;
            token.role = dbUser.role;
            foundUser = true;
          }
        } finally {
          trace.log({ foundUser });
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = typeof token.id === "string" ? token.id : (token.sub ?? "");
        session.user.role = isRole(token.role) ? token.role : undefined;
      }

      return session;
    },
  },
});

export { authorizeCredentials };
