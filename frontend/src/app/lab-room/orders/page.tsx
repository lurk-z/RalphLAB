import { requireActiveProject } from "@/lib/active-project";
import { localWorkOrderDemo } from "@/lib/auth";
import WorkOrders from "./WorkOrders";
import "./orders.css";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: { project?: string; order?: string };
}) {
  const active = await requireActiveProject(searchParams.project, true);
  return (
    <WorkOrders
      initialProject={active ?? 0}
      initialOrder={
        typeof searchParams.order === "string" ? searchParams.order : ""
      }
      signedIn
      localDemo={localWorkOrderDemo}
    />
  );
}
