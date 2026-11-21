import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import LabRoom from "@/components/lab-room/LabRoom";
import { authOptions, localWorkOrderDemo } from "@/lib/auth";
import { loginEnabled } from "@/lib/login-mode";
import { loginRedirect, parseRoomQuery } from "@/lib/lab-room/route";

/**
 * `/lab-room` · the canonical room. Every entry (bare, D01, a project, a work order or protein
 * desk, a timed study, the station, a bookmarked Studio Lab/Graph link) resolves here to one
 * room state; `tab=assess` keeps Studio's Assessment.
 */
export default async function LabRoomPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const parsed = parseRoomQuery(searchParams);
  if (!parsed.state) redirect(parsed.redirect);
  const state = parsed.state;
  const session = loginEnabled ? await getServerSession(authOptions) : null;
  // A local developer without Google sign-in keeps the existing local work-order preview.
  const localDevelopment = process.env.NODE_ENV === "development" && !process.env.GOOGLE_CLIENT_ID;
  if (loginEnabled && !session && !localDevelopment) redirect(loginRedirect(state));
  const viewer = session?.user?.id ?? session?.user?.email ?? "guest";
  return (
    <LabRoom
      initial={state}
      viewer={viewer}
      localPreview={loginEnabled && (!session || Boolean(session.user?.id?.startsWith("local-demo-")))}
      deskSignedIn={!loginEnabled || Boolean(session?.user)}
      deskLocalLogin={localWorkOrderDemo}
    />
  );
}
