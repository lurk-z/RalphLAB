import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { randomUUID } from "crypto";
import { createBackendAuthToken } from "@/lib/backend-auth-token";

export const localWorkOrderDemo = process.env.NODE_ENV === "development"
  && process.env.LAB_LOCAL_WORK_ORDERS === "1" && !process.env.GOOGLE_CLIENT_ID
  && ["http://localhost:3000", "http://127.0.0.1:3000"].includes(process.env.NEXTAUTH_URL ?? "");

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 },
  pages: { signIn: "/login" },
  providers: [
    GoogleProvider({ clientId: process.env.GOOGLE_CLIENT_ID || "", clientSecret: process.env.GOOGLE_CLIENT_SECRET || "" }),
    ...(localWorkOrderDemo ? [CredentialsProvider({
      id: "lab-demo", name: "RalphLAB local demo", credentials: {},
      async authorize() { return { id: `local-demo-${randomUUID()}`, name: "Local lab" }; },
    })] : []),
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account) token.verifiedEmail = account.provider === "google" && profile
        && "email_verified" in profile && profile.email_verified === true ? token.email : null;
      if (token.sub) token.backendToken = createBackendAuthToken(token.sub, token.email,
        typeof token.verifiedEmail === "string" ? token.verifiedEmail : undefined);
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub;
      session.backendToken = typeof token.backendToken === "string" ? token.backendToken : undefined;
      return session;
    },
  },
};
