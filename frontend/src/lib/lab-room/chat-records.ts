import type { LabLink } from "./chat-tools.ts"

export type StatusPlan = {tool:"read_project_work";args:{collection:"orders"|"timed";record_id:string|null}}
type Read = (path:string)=>Promise<any>
type Save = (path:string,data:object)=>Promise<any>
type Order = {id:string;state:string;request:{brief:string;kind?:string;draft?:string;assignee?:string;case_template?:string};
  stages?:{id:string;title:string;status:string}[];events:{message:string;command?:{id:string};structure?:{pdb:string};
    pose?:{rmsd:number;pdb:string};comparison_report?:{alignment:{reference_pdb:string;mobile_pdb:string;atom_count:number;rmsd_angstrom:number}}}[]}
type Timed = {id:string;brief:string;state:string;metric:string;unit:string;rounds:{hour:number;result?:{value:number;source:string}}[]}
const states:Record<string,string>={active:"กำลังติดตาม",paused:"พักรอการตัดสินใจ",complete:"เสร็จแล้ว",stopped:"ยุติงาน",awaiting_inputs:"รอข้อมูล",
  in_progress:"กำลังดำเนินการ",awaiting_approval:"รออนุมัติ",approved:"อนุมัติแล้ว",rejected:"ปิดงาน",ready:"พร้อมรับผล",blocked:"รอขั้นก่อนหน้า"}
const stateName=(name:string)=>states[name]||name
export const isLabId=(value:unknown):value is string=>typeof value==="string" && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value)
export async function readProjectWork(plan:StatusPlan,project:number,read:Read) {
  const {collection,record_id:id}=plan.args
  if ((id!==null && !isLabId(id)) || (collection!=="orders" && collection!=="timed")) throw Error("ระบุใบงานที่ต้องการอ่าน")
  const base=collection==="orders"?"/api/lab/projects/"+project+"/orders":"/api/timed"
  const labLink:LabLink={project,target:collection,...(id && {id})}
  if (!id){
    const rows=await read(base) as (Order|Timed)[]
    const label=collection==="orders"?"ใบงาน Agent":"งานติดตามตามเวลา"
    const titles=rows.slice(0,10).map(r=>("request" in r?r.request.brief:r.brief)+" · "+stateName(r.state)+" · "+r.id)
    const counts = new Map<string, number>()
    for (const row of rows) counts.set(row.state, (counts.get(row.state) || 0) + 1)
    const summary = [...counts].map(([state, n]) => stateName(state) + " " + n + " งาน").join(" · ")
    const listed = rows.length > titles.length ? "แสดง " + titles.length + " งานล่าสุด" : ""
    return {text:[label+" ในโปรเจกต์ "+rows.length+" งาน", summary, listed, ...titles].filter(Boolean).join("\n"),labLink}
  }
  if (collection==="timed"){
    const {row:r}=await read(base+"/"+id) as {row:Timed}
    const rounds=r.rounds.map(q=>q.hour+" ชม. · "+(q.result?r.metric+" "+q.result.value+" "+r.unit+" · "+q.result.source:"รอบันทึกผล"))
    return {text:[r.brief,stateName(r.state),...rounds].join("\n"),labLink}
  }
  const row=await read(base+"/"+id) as Order
  return {text:[row.request.brief,stateName(row.state),row.request.draft,
    ...(row.stages||[]).map(s=>s.id+" · "+s.title+" · "+stateName(s.status)),
    ...row.events.slice(-3).map(e=>e.message)].filter(Boolean).join("\n"),labLink}
}

export type ProteinPlan={tool:"protein_study";args:{model:"gfp"|"insulin"|"insulin_lispro";brief:string;operation?:"open"|"analyze";order_id?:string|null}}
export async function runProteinPlan(plan:ProteinPlan,project:number,actionId:string,read:Read,save:Save) {
  const {model,brief,order_id:orderId,operation}=plan.args
  if (!["gfp","insulin","insulin_lispro"].includes(model) || (orderId!=null&&!isLabId(orderId))) throw Error("ระบุโครงสร้างอ้างอิงหรือใบงานที่ต้องการ")
  const base="/api/lab/projects/"+project
  const row:Order=orderId ? await read(base+"/orders/"+orderId) : await save(base+"/studies",{
    id:actionId,discipline:"discovery",brief:(model==="gfp"?"GFP":"Insulin")+" · "+brief,
    ...(model==="insulin_lispro"&&{case_template:"insulin-lispro-v1"})})
  if(row.id!==(orderId||actionId))throw Error("ยังยืนยันใบงานโปรตีนไม่ได้")
  const labLink:LabLink={target:"protein",project,id:row.id}
  if(operation!=="analyze")return {text:brief+"\nใบงานโต๊ะโปรตีน 3D · "+row.id,labLink}
  const comparison=model==="insulin_lispro", pdb=model==="gfp"?"1EMA":"3I40"
  if(comparison ? row.request.case_template!=="insulin-lispro-v1" : row.request.case_template || !row.events.some(e=>e.structure?.pdb===pdb))
    throw Error("โครงสร้างของใบงานไม่ตรงกับคำสั่ง")
  const existing=row.events.some(e=>e.command?.id===actionId) || (comparison && row.events.some(e=>e.comparison_report))
  const saved:Order=existing ? row : await save(base+"/orders/"+row.id+(comparison?"/insulin-comparisons":"/protein-runs"),{
    id:actionId,expected_sequence:row.events.length,...(!comparison&&{model:model==="gfp"?"1EMA-A-17-28-v1":"3I40-AB-v1",task:"align_reference",start_from:"latest"})})
  const alignment=saved.events.findLast(e=>e.comparison_report)?.comparison_report?.alignment
  const pose=saved.events.findLast(e=>e.pose?.pdb===pdb)?.pose
  if(comparison && alignment)return {text:`เทียบโครงสร้างอ้างอิง ${alignment.reference_pdb} และ ${alignment.mobile_pdb} บน ${alignment.atom_count} ตำแหน่ง ได้ RMSD ${alignment.rmsd_angstrom} Å\nใบงาน · ${row.id}`,labLink}
  if(!comparison && pose)return {text:`จัดแนวโครงสร้างอ้างอิง ${pose.pdb} แล้ว ได้ RMSD ${pose.rmsd} Å\nใบงาน · ${row.id}`,labLink}
  throw Error("ใบงานยังไม่มีผลการจัดแนวที่ยืนยันแล้ว")
}
