import { redirect } from "next/navigation";
import { loginEnabled } from "@/lib/login-mode";
import { currentSession, requireActiveProject } from "@/lib/active-project";
import Studio from "./Studio";

export default async function AssessPage({searchParams}: {
  searchParams: {projectId?: string; tab?: string; agent?: string};
}) {
  const project = await requireActiveProject(searchParams.projectId);
  if (project && !searchParams.projectId) {
    const query = new URLSearchParams({projectId: String(project)});
    if (searchParams.tab) query.set("tab", searchParams.tab);
    if (searchParams.agent) query.set("agent", searchParams.agent);
    redirect("/assess?" + query);
  }
  const session = loginEnabled ? await currentSession() : null;
  const viewer = session?.user?.id ?? session?.user?.email ?? "guest";
  return <Studio key={JSON.stringify([viewer, project])} viewer={viewer} searchParams={searchParams} />;
}
