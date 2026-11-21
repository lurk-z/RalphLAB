import { loginEnabled } from "@/lib/login-mode";
import { getServerSession } from "next-auth";
import { authOptions, localWorkOrderDemo } from "@/lib/auth";
import WorkOrders from "./WorkOrders";
import "./orders.css";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: { project?: string; order?: string };
}) {
  const session = loginEnabled ? await getServerSession(authOptions) : null;
  return (
    <WorkOrders
      initialProject={Number(searchParams.project) || 0}
      initialOrder={
        typeof searchParams.order === "string" ? searchParams.order : ""
      }
      signedIn={!loginEnabled || Boolean(session?.user)}
      localDemo={localWorkOrderDemo}
    />
  );
}
