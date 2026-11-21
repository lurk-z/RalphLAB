type Discipline = "synthesis"|"discovery"|"stability"|"trace"|"validation"|"scale_up"
type WorkLink = {target:"orders"|"timed";project:number;id:string}
type WorkReceipt = {text:string;labLink:WorkLink}
type Intake = {brief:string;discipline:Discipline;reaction_steps:number|null;parallel:boolean;start_date:string|null;months:number[]}
type Stage = {study_id:string;sequence:number;stage:string;disposition:"record"|"hold";observed_on:string;
  evidence:string;finding:string;unit:string|null;measurements:number[]}
type TimedEvent = {study_id:string;version:number;action:"observe"|"issue"|"continue"|"stop"|"followup";note:string;
  value:number|null;unit:string|null;source:string|null;observed_at:string|null;hours:number|null}
export type WorkPlan =
  | {tool:"create_study_record";args:Intake}
  | {tool:"record_study_stage";args:Stage}
  | {tool:"update_timed_study";args:TimedEvent}

type Row = {id?:string;request?:{discipline?:string};stages?:{id:string;title:string;role:string;status:string}[];
  events?:{command?:{id?:string}}[];row?:{id:string;state:string;chat_commands?:{id:string}[]}}
type WorkIO = {save:(path:string,data:object)=>Promise<Row>}
const names:Record<Discipline,string>={synthesis:"การสังเคราะห์หลายขั้นตอน",discovery:"การพัฒนายาและสูตรตำรับ",stability:"ความคงตัว",
  trace:"การตรวจสารระดับร่องรอย",validation:"การตรวจสอบวิธีวิเคราะห์",scale_up:"การขยายขนาดการผลิต"}
const uuidPattern=/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i
export function isWorkPlan(plan:{tool:string}):plan is WorkPlan {
  return ["create_study_record","record_study_stage","update_timed_study"].includes(plan.tool)
}
export async function applyWorkPlan(plan:WorkPlan,project:number,actionId:string,io:WorkIO):Promise<WorkReceipt>{
  const orders="/api/lab/projects/"+project
  if(plan.tool==="create_study_record"){
    const {brief,discipline,reaction_steps,parallel,start_date,months}=plan.args
    if(!Object.hasOwn(names,discipline))throw Error("ไม่พบประเภทใบงานที่ระบุ")
    const body={id:actionId,brief,discipline,...(discipline==="synthesis" && {reaction_steps,parallel}),
      ...(discipline==="stability" && {start_date,months})}
    const study=await io.save(orders+"/studies",body)
    if(study.id!==actionId || !study.stages?.length)throw Error("ยังยืนยันแผนของใบงานไม่ได้")
    const ready=study.stages.filter(s=>s.status==="ready")
    const progress=ready.length ? "ขั้นที่รับข้อมูลได้ตอนนี้ · "+ready.map(s=>s.id+" "+s.title).join(", ") : "รอรอบติดตามที่บันทึกไว้ในใบงาน"
    return {text:"เปิดใบงาน"+names[discipline]+" · "+brief+"\n"+study.stages.length+" ขั้น · "+progress,
      labLink:{target:"orders",project,id:study.id}}
  }
  const id=plan.args.study_id
  if(!uuidPattern.test(id))throw Error("ไม่พบรหัสใบงานที่ต้องการแก้ไข")
  if(plan.tool==="record_study_stage"){
    const {stage,sequence,disposition,observed_on,evidence,finding,measurements,unit}=plan.args
    if(!/^[A-Za-z0-9_-]{1,40}$/.test(stage))throw Error("รหัสขั้นงานไม่ถูกต้อง")
    const study=await io.save(orders+"/orders/"+id+"/stages/"+stage+"/results",{id:actionId,expected_sequence:sequence,
      disposition,observed_on,evidence,finding,measurements,unit,literature:[]})
    if(study.id!==id || !study.events?.some(e=>e.command?.id===actionId))throw Error("ยังยืนยันการบันทึกผลไม่ได้")
    return {text:(disposition==="hold"?"บันทึกปัญหาที่ขั้น ":"บันทึกผลขั้น ")+stage+" · "+finding+"\nแหล่งข้อมูล · "+evidence,
      labLink:{target:"orders",id,project}}
  }
  const {action,version,note,value,source,unit,observed_at,hours}=plan.args
  const observed=observed_at==="now" ? "now" : observed_at?Date.parse(observed_at):null
  const body={command_id:actionId,version,action,note,...(action==="observe" && {value,source,unit,observed}),
    ...(action==="followup" && {hours})}
  const result=await io.save("/api/timed/"+id+"/events",body)
  if(result.row?.id!==id || !result.row.chat_commands?.some(c=>c.id===actionId))throw Error("ยังยืนยันการบันทึกรอบติดตามไม่ได้")
  const message={observe:"บันทึกค่าที่วัด "+value+" "+unit,issue:"พักงานตามปัญหาที่แจ้ง",continue:"บันทึกคำสั่งให้ติดตามต่อ",
    stop:"ยุติการติดตาม",followup:"เพิ่มรอบติดตามในอีก "+hours+" ชั่วโมง"}[action]
  return {text:message+" · "+note,labLink:{target:"timed",id,project}}
}
