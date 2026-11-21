"use client";

import { SessionContext, SessionProvider as Provider } from "next-auth/react";
import { loginEnabled } from "@/lib/login-mode";

const guestSession = { data: null, status: "unauthenticated" as const, update: async () => null };

export function SessionProvider({ children }: { children: React.ReactNode }) {
  if (loginEnabled) return <Provider>{children}</Provider>;
  return <SessionContext.Provider value={guestSession}>{children}</SessionContext.Provider>;
}
