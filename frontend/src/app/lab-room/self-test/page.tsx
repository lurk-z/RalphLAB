import { redirect } from "next/navigation";
import { requireActiveProject } from "@/lib/active-project";
import ChatQsarResult from "./ChatQsarResult";
export default async function SelfTest({searchParams}:{searchParams:{project?:string;job?:string}}) {
  const project=await requireActiveProject(searchParams.project);
  if(project && searchParams.job)return <ChatQsarResult project={project} id={searchParams.job}/>;
  redirect(project ? "/assess?tab=assess&projectId="+project : "/assess?tab=assess");
}
