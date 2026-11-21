import { redirect } from "next/navigation";
import StudioPage from "../(dashboard)/assess/page";
import { localLabPreview } from "@/lib/lab-preview";

export default function LabRoomPage({ searchParams }: {
  searchParams: { tab?: string; projectId?: string };
}) {
  const tab = searchParams.tab === "nodes" || searchParams.tab === "assess" ? searchParams.tab : "lab";
  if (!localLabPreview || searchParams.projectId !== undefined) {
    const query = new URLSearchParams({ tab });
    if (searchParams.projectId !== undefined) query.set("projectId", searchParams.projectId);
    redirect("/assess?" + query.toString());
  }
  return <StudioPage searchParams={{ tab }} />;
}
