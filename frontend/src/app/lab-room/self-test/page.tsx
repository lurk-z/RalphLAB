import { redirect } from "next/navigation";
import { requireActiveProject } from "@/lib/active-project";
export default async function SelfTest({searchParams}:{searchParams:{project?:string}}) {
  const project=await requireActiveProject(searchParams.project);
  redirect(project ? "/assess?tab=assess&projectId="+project : "/assess?tab=assess");
}
