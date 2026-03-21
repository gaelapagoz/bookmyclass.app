import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";

import { prisma } from "@/lib/db";
import { authorizeCredentials, type AuthUser } from "@/lib/auth/credentials-authorize";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
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
        const dbUser = await prisma.user.findUnique({
          where: { id: token.sub },
          select: { id: true, role: true },
        });

        if (dbUser) {
          token.id = dbUser.id;
          token.role = dbUser.role;
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id ?? token.sub ?? "";
        session.user.role = token.role;
      }

      return session;
    },
  },
});

export { authorizeCredentials };
