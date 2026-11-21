// Only these project routes can be opened or written from an OpenAI tool call.
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
    case "self_test": return "/lab-room/self-test?" + query
  }
}
const titles = {orders:"ใบงาน Agent", protein:"โต๊ะโปรตีน 3D", timed:"งานติดตามตามเวลา", self_test:"ทดสอบสารด้วยตัวเอง"}
type Plan =
  | {answer:string}
  | {tool:"show_tool";args:{target:LabLink["target"]}}
  | {tool:"create_brief";args:{title:string;draft:string;assignee:string}}
  | {tool:"protein_study";args:{model:"gfp"|"insulin"|"insulin_lispro";brief:string}}
  | {tool:"schedule_observations";args:{brief:string;goal:string;condition:string;metric:string;unit:string;duration:number;rounds:number[];exception:string}}
type Saved = {id:string}
export async function applyLabPlan(plan:Plan, role:string, project:number, id:string,
  save:(path:string,data:object)=>Promise<Saved>):Promise<{text:string;labLink?:LabLink}> {
  if ("answer" in plan && plan.answer?.trim()) return {text:plan.answer}
  if (!("tool" in plan) || role !== "director") throw Error("คำสั่งจาก OpenAI ไม่รองรับในแชตนี้")
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
      target = "protein"
      row = await save(base + "/studies",{id,discipline:"discovery",
        brief:(plan.args.model === "gfp" ? "GFP" : "Insulin") + " · " + plan.args.brief,
        ...(plan.args.model === "insulin_lispro" && {case_template:"insulin-lispro-v1"})})
      text = plan.args.brief
      break
    case "schedule_observations":
      target = "timed"
      row = await save("/api/timed",{...plan.args,id,rule:null})
      text = plan.args.brief + "\n" + plan.args.metric + " (" + plan.args.unit + ") · " +
        Array.from(new Set([0,...plan.args.rounds,plan.args.duration])).sort((a,b)=>a-b).join(", ") + " ชั่วโมง"
      break
    default: throw Error("คำสั่งจาก OpenAI ไม่รองรับ")
  }
  if (row?.id !== id) throw Error("ยังยืนยันการบันทึกใบงานไม่ได้")
  return {text:text + "\n\nบันทึก" + titles[target] + " · " + id.slice(0,8), labLink:{target,id,project}}
}
