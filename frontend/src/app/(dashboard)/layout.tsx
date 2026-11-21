import type { ReactNode } from "react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { loginEnabled } from "@/lib/login-mode";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  if (loginEnabled && !(await getServerSession(authOptions))) redirect("/login");
  return children;
}
