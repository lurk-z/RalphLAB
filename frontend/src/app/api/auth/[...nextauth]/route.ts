import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";
import { loginEnabled } from "@/lib/login-mode";

const handler = loginEnabled ? NextAuth(authOptions) : () => new Response(null, { status: 404 });
export { handler as GET, handler as POST };
