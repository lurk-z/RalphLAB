// Only these project routes can be opened or written from an OpenAI tool call.
import { readProjectWork, runProteinPlan, type StatusPlan, type ProteinPlan } from "./chat-records.ts"
import { isWorkPlan, applyWorkPlan, type WorkPlan } from "./work-tools.ts"
import { applyQsarPlan, type QsarPlan } from "./qsar-chat-tools.ts"
export type LabLink = { target: "orders" | "protein" | "timed" | "self_test"; project: number; id?: string }
export function labHref(link?: LabLink) {
  if (!link || !Number.isSafeInteger(link.project) || link.project < 1) return
  if (link.id && !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(link.id)) return
  const query = new URLSearchParams({ project: String(link.project) })
  switch (link.target) {
    case "orders":
      if (link.id) query.set("order", link.id)
      return "/lab-room/orders?" + query
    case "protein":
      query.set(link.id ? "order" : "table", link.id || "protein")
      return "/lab-room?" + query
    case "timed":
      if (link.id) query.set("id", link.id)
      return "/lab-room/timed?" + query
    case "self_test":
      if (link.id) query.set("job",link.id)
      return "/lab-room/self-test?" + query
  }
}
const titles = {orders:"ใบงาน Agent", protein:"โต๊ะโปรตีน 3D", timed:"งานติดตามตามเวลา", self_test:"ทดสอบสารด้วยตัวเอง"}
export type Plan =
  | {answer:string}
  | {tool:"show_tool";args:{target:LabLink["target"]}}
  | {tool:"create_brief";args:{title:string;draft:string;assignee:string}}
  | ProteinPlan | StatusPlan | WorkPlan | QsarPlan
  | {tool:"schedule_observations";args:{brief:string;goal:string;condition:string;metric:string;unit:string;duration:number;rounds:number[];exception:string;rule?:{direction:"above"|"below";limit:number}|null}}
type Saved = {id:string}
type Reply={text:string;labLink?:LabLink;labLinks?:LabLink[]}
type Save=(path:string,data:object)=>Promise<any>
type Read=(path:string)=>Promise<any>
const noRead:Read=async()=>{throw Error("อ่านข้อมูลของโปรเจกต์ไม่ได้")}
export async function applyLabPlan(plan:Plan, role:string, project:number, id:string,
  save:Save,read:Read=noRead):Promise<Reply> {
  if ("answer" in plan && plan.answer?.trim()) return {text:plan.answer}
  if("tool" in plan && plan.tool==="read_project_work")return readProjectWork(plan,project,read)
  if("tool" in plan && plan.tool==="read_chat_qsar" && ["director","analyst","evaluator"].includes(role))
    return applyQsarPlan(plan,project,id,{read,save})
  if (!("tool" in plan) || role !== "director") throw Error("คำสั่งจาก OpenAI ไม่รองรับในแชตนี้")
  if(isWorkPlan(plan))return applyWorkPlan(plan,project,id,{save})
  if(plan.tool==="run_chat_qsar"||plan.tool==="read_chat_qsar")return applyQsarPlan(plan,project,id,{read,save})
  const base = "/api/lab/projects/" + project
  let target:LabLink["target"], row:Saved, text:string
  switch (plan.tool) {
    case "show_tool":
      target = plan.args.target
      if (!Object.hasOwn(titles,target)) throw Error("ไม่พบเครื่องมือที่ขอ")
      return {text:titles[target], labLink:{target,project}}
    case "create_brief":
      target = "orders"
      row = await save(base + "/director-briefs",{...plan.args,id})
      text = plan.args.title + "\n\n" + plan.args.draft
      break
    case "protein_study":
      return runProteinPlan(plan,project,id,read,save)
    case "schedule_observations":
      target = "timed"
      row = await save("/api/timed",{...plan.args,id,rule:plan.args.rule??null})
      text = plan.args.brief + "\n" + plan.args.metric + " (" + plan.args.unit + ") · " +
        Array.from(new Set([0,...plan.args.rounds,plan.args.duration])).sort((a,b)=>a-b).join(", ") + " ชั่วโมง"
      break
    default: throw Error("คำสั่งจาก OpenAI ไม่รองรับ")
  }
  if (row?.id !== id) throw Error("ยังยืนยันการบันทึกใบงานไม่ได้")
  return {text:text + "\n\nบันทึก" + titles[target] + " · " + id.slice(0,8), labLink:{target,id,project}}
}

// A retried chat turn reuses its message ID, including after some writes succeeded.
async function actionId(turnId:string,index:number) {
  const bytes=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(turnId+"/"+index)))
  bytes[6]=(bytes[6]&15)|64; bytes[8]=(bytes[8]&63)|128
  const hex=Array.from(bytes.slice(0,16),b=>b.toString(16).padStart(2,"0")).join("")
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join("-")
}
export async function applyLabTurn(plan:Plan|{actions:Plan[]},role:string,project:number,id:string,save:Save,read:Read):Promise<Reply>{
  if(!("actions" in plan))return applyLabPlan(plan,role,project,id,save,read)
  if(!Array.isArray(plan.actions)||!plan.actions.length||plan.actions.length>4)throw Error("อ่านรายการคำสั่งไม่ได้")
  const receipts:Reply[]=[]
  for(const [index,action] of plan.actions.entries()){
    try{receipts.push(await applyLabPlan(action,role,project,await actionId(id,index),save,read))}
    catch(e){
      const detail=e instanceof Error?e.message:"ทำงานไม่สำเร็จ"
      throw Error([...(receipts.length?["ดำเนินการแล้ว",...receipts.map(r=>r.text)] : []),"คำสั่งที่ "+(index+1)+" · "+detail].join("\n"))
    }
  }
  return {text:receipts.map(r=>r.text).join("\n\n"),labLinks:receipts.flatMap(r=>r.labLink?[r.labLink]:[])}
}
