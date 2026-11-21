import { getServerSession } from "next-auth";
import { authOptions, localWorkOrderDemo } from "@/lib/auth";
import WorkOrders from "./WorkOrders";
import "./orders.css";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: { project?: string; order?: string };
}) {
  const session = await getServerSession(authOptions);
  return (
    <WorkOrders
      initialProject={Number(searchParams.project) || 0}
      initialOrder={
        typeof searchParams.order === "string" ? searchParams.order : ""
      }
      signedIn={Boolean(session?.user)}
      localDemo={localWorkOrderDemo}
    />
  );
}
