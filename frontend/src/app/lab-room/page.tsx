import StudioPage from "../(dashboard)/assess/page";
import { localLabPreview } from "@/lib/lab-preview";
import { loginEnabled } from "@/lib/login-mode";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import LabRoomExplorer from "@/components/three/skincare-lab/LabRoomExplorer";
import { authOptions, localWorkOrderDemo } from "@/lib/auth";
import "../(dashboard)/lab-chat.css";

export default async function LabRoomPage({
  searchParams,
}: {
  searchParams: { project?: string; order?: string; table?: string; tab?: string; projectId?: string; agent?: string };
}) {
  const station = searchParams.table === "station";
  if (!station && searchParams.table !== "protein" && !searchParams.order && !searchParams.project) {
    const tab = searchParams.tab === "nodes" || searchParams.tab === "graph" || searchParams.tab === "assess" ? searchParams.tab : "lab";
    if (!localLabPreview || searchParams.projectId !== undefined) {
      const query = new URLSearchParams({ tab });
      if (searchParams.projectId !== undefined) query.set("projectId", searchParams.projectId);
      if (searchParams.agent) query.set("agent", searchParams.agent);
      redirect("/assess?" + query.toString());
    }
    return <StudioPage searchParams={{ tab, agent: searchParams.agent }} />;
  }
  const session = loginEnabled ? await getServerSession(authOptions) : null;
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
  if (
    loginEnabled && !session &&
    !(process.env.NODE_ENV === "development" && !process.env.GOOGLE_CLIENT_ID)
  ) {
    const callback = desk
      ? `/lab-room?project=${desk.project}&order=${desk.order}`
      : launcher
        ? "/lab-room?table=protein"
        : station ? "/lab-room?table=station" : "/lab-room";
    redirect("/login?callbackUrl=" + encodeURIComponent(callback));
  }
  return (
    <LabRoomExplorer
      key={desk ? desk.project + "/" + desk.order : launcher ? "desk" : "room"}
      localPreview={loginEnabled && (!session || session.user?.id?.startsWith("local-demo-"))}
      projectId={desk?.project}
      desk={desk}
      deskLauncher={launcher}
      deskSignedIn={!loginEnabled || Boolean(session?.user)}
      deskLocalLogin={localWorkOrderDemo}
    />
  );
}
