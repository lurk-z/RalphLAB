import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import LabRoomExplorer from "@/components/three/skincare-lab/LabRoomExplorer";
import { authOptions } from "@/lib/auth";
import "../(dashboard)/lab-chat.css";

export default async function LabRoomPage() {
  const session = await getServerSession(authOptions);
  if (session) return <LabRoomExplorer localPreview={session.user?.id?.startsWith("local-demo-")} />;
  if (process.env.NODE_ENV === "development" && !process.env.GOOGLE_CLIENT_ID) {
    return <LabRoomExplorer localPreview />;
  }
  redirect("/login?callbackUrl=%2Flab-room");
}
