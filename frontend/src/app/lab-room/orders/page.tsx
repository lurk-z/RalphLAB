import { getServerSession } from "next-auth";
import { authOptions, localWorkOrderDemo } from "@/lib/auth";
import WorkOrders from "./WorkOrders";
import "./orders.css";

export default async function OrdersPage() {
  const session = await getServerSession(authOptions);
  return (
    <WorkOrders
      signedIn={Boolean(session?.user)}
      localDemo={localWorkOrderDemo}
    />
  );
}
