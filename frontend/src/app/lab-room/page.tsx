import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import LabRoomExplorer from "@/components/three/skincare-lab/LabRoomExplorer";
import { authOptions, localWorkOrderDemo } from "@/lib/auth";
import "../(dashboard)/lab-chat.css";

export default async function LabRoomPage({
  searchParams,
}: {
  searchParams: { project?: string; order?: string; table?: string };
}) {
  const session = await getServerSession(authOptions);
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
    !session &&
    !(process.env.NODE_ENV === "development" && !process.env.GOOGLE_CLIENT_ID)
  ) {
    const callback = desk
      ? `/lab-room?project=${desk.project}&order=${desk.order}`
      : launcher
        ? "/lab-room?table=protein"
        : "/lab-room";
    redirect("/login?callbackUrl=" + encodeURIComponent(callback));
  }
  return (
    <LabRoomExplorer
      key={desk ? desk.project + "/" + desk.order : launcher ? "desk" : "room"}
      localPreview={!session || session.user?.id?.startsWith("local-demo-")}
      projectId={desk?.project}
      desk={desk}
      deskLauncher={launcher}
      deskSignedIn={Boolean(session?.user)}
      deskLocalLogin={localWorkOrderDemo}
    />
  );
}
