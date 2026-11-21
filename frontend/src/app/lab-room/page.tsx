import { currentSession, requireActiveProject } from "@/lib/active-project";
import { localLabPreview } from "@/lib/lab-preview";
import { redirect } from "next/navigation";
import LabRoom from "@/components/lab-room/LabRoom";
import { localWorkOrderDemo } from "@/lib/auth";
import { loginEnabled } from "@/lib/login-mode";
import { loginRedirect, parseRoomQuery, roomHref } from "@/lib/lab-room/route";

/**
 * `/lab-room` · the canonical room. Every entry (bare, D01, a project, a work order or protein
 * desk, a timed study, the station, a bookmarked Studio Lab/Graph link) resolves here to one
 * room state; `tab=assess` keeps Studio's Assessment.
 */
export default async function LabRoomPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const parsed = parseRoomQuery(searchParams);
  if (!parsed.state) redirect(parsed.redirect);
  const requested = parsed.state;
  const session = loginEnabled ? await currentSession() : null;
  if (loginEnabled && !session?.user) redirect(loginRedirect(requested));
  const context = requested.context;
  const id = context.kind === "project" || context.kind === "order" || context.kind === "demo" ? context.projectId : null;
  const active = await requireActiveProject(id == null ? undefined : String(id), context.kind === "order", roomHref(requested));
  const state = active && context.kind === "none"
    ? { ...requested, context: { kind: "project" as const, projectId: active } }
    : active && context.kind === "demo" ? { ...requested, context: { ...context, projectId: active } } : requested;
  const viewer = session?.user?.id ?? session?.user?.email ?? "guest";
  return (
    <LabRoom
      key={JSON.stringify([viewer, state.context])}
      initial={state}
      viewer={viewer}
      localPreview={localLabPreview}
      deskSignedIn={!loginEnabled || Boolean(session?.user)}
      deskLocalLogin={localWorkOrderDemo}
    />
  );
}
