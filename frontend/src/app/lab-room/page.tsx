import StudioPage from "../(dashboard)/assess/Studio";
import { localLabPreview } from "@/lib/lab-preview";
import { loginEnabled } from "@/lib/login-mode";
import { redirect } from "next/navigation";
import LabRoomExplorer from "@/components/three/skincare-lab/LabRoomExplorer";
import { localWorkOrderDemo } from "@/lib/auth";
import { requireActiveProject } from "@/lib/active-project";
import "../(dashboard)/lab-chat.css";

export default async function LabRoomPage({
  searchParams,
}: {
  searchParams: { project?: string; order?: string; table?: string; tab?: string; projectId?: string; agent?: string };
}) {
  const active = await requireActiveProject(searchParams.project ?? searchParams.projectId, Boolean(searchParams.order));
  const station = searchParams.table === "station";
  if (!station && searchParams.table !== "protein" && !searchParams.order && !searchParams.project) {
    const tab = searchParams.tab === "nodes" || searchParams.tab === "graph" || searchParams.tab === "assess" ? searchParams.tab : "lab";
    if (loginEnabled || !localLabPreview || searchParams.projectId !== undefined) {
      const query = new URLSearchParams({ tab });
      if (active) query.set("projectId", String(active));
      if (searchParams.agent) query.set("agent", searchParams.agent);
      redirect("/assess?" + query.toString());
    }
    return <StudioPage searchParams={{ tab, agent: searchParams.agent }} />;
  }
  const project = Number(searchParams.project);
  const order = searchParams.order;
  const desk =
    Number.isSafeInteger(project) &&
    project > 0 &&
    typeof order === "string" &&
    /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(order)
      ? { project, order }
      : null;
  const launcher =
    searchParams.table === "protein" || Boolean(searchParams.order && !desk);
  return (
    <LabRoomExplorer
      key={desk ? desk.project + "/" + desk.order : launcher ? "desk" : "room"}
      localPreview={localLabPreview}
      projectId={active ?? desk?.project}
      desk={desk}
      deskLauncher={launcher}
      deskSignedIn
      deskLocalLogin={localWorkOrderDemo}
    />
  );
}
