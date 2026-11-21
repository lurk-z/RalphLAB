import { redirect } from "next/navigation";
import { requireActiveProject } from "@/lib/active-project";
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
  return <Studio searchParams={searchParams} />;
}
