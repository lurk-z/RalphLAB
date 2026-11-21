import {requireActiveProject} from "@/lib/active-project";
import TimedReadout from "./TimedReadout";
export default async function Page({searchParams}:{searchParams:{project?:string;id?:string}}) {
  const project=await requireActiveProject(searchParams.project);
  return <TimedReadout project={project||0} id={searchParams.id}/>;
}
