type Region = "face" | "eye" | "hand" | "forearm"
export type QsarPlan =
  | {tool:"run_chat_qsar";args:{region:Region;ingredients:{cid:number;percent:number}[]}}
  | {tool:"read_chat_qsar";args:{job_id:string;use_latest:boolean}}
const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i
const states:Record<string,string> = {preparing:"กำลังเตรียม",queued:"รอเครื่องคำนวณ",running:"กำลังคำนวณ",complete:"คำนวณเสร็จแล้ว",failed:"คำนวณไม่สำเร็จ"}
const regions:Record<string,string> = {face:"ใบหน้า",eye:"รอบดวงตา",hand:"มือ",forearm:"ท้องแขน"}
const names:Record<number,string> = {962:"น้ำ",753:"กลีเซอริน",936:"ไนอะซินาไมด์",4678:"แพนทีนอล",1176:"ยูเรีย",311:"กรดซิตริก"}
const endpoints:Record<string,string> = {skin:"ระคายเคืองผิว",eye:"ระคายเคืองตา",sens:"การก่อภูมิแพ้ทางผิวหนัง",acute:"พิษเฉียบพลัน"}
interface Job {
  id:string;state:string;issue?:string
  formula:{region:string;ingredients:{cid?:number;name?:string;percent:number}[]}
  result?:{endpoints:Record<string,{peak_score:number;confidence?:string;in_domain?:boolean}>}
}
function isJob(value:unknown):value is Job {
  if (!value || typeof value!=="object") return false
  const row=value as Partial<Job>
  return typeof row.id==="string" && uuid.test(row.id) && typeof row.state==="string" &&
    Object.hasOwn(states,row.state) && typeof row.formula?.region==="string" &&
    Array.isArray(row.formula.ingredients) && row.formula.ingredients.every(i=>i && Number.isFinite(i.percent))
}
export function qsarReceipt(row:Job) {
  const formula=row.formula.ingredients.map(i=>(i.name || names[i.cid??0] || ("CID "+i.cid))+" "+i.percent+"%").join(" + ")
  const lines=["QSAR · "+states[row.state],formula+" · "+(regions[row.formula.region]||row.formula.region)]
  if (row.state==="complete"){
    for(const [key,label] of Object.entries(endpoints)){
      const reading=row.result?.endpoints?.[key]
      if(!reading || !Number.isFinite(reading.peak_score))continue
      lines.push(label+" "+reading.peak_score+"/100"+(reading.confidence?" · ความเชื่อมั่น "+reading.confidence:"")+
        (reading.in_domain===false?" · นอกขอบเขตโมเดล":""))
    }
    if(lines.length===2)lines.push("ยังไม่มีคะแนนให้แสดงในงานนี้")
    else lines.push("ค่าที่แสดงเป็นผลทำนายจากโมเดล")
  }
  if(row.issue)lines.push(row.issue)
  lines.push("เลขงาน "+row.id)
  return lines.join("\n")
}
interface Tools {save:(path:string,data:object)=>Promise<unknown>;read:(path:string)=>Promise<unknown>}
export async function applyQsarPlan(plan:QsarPlan,project:number,actionId:string,io:Tools) {
  const path="/api/lab/projects/"+project+"/chat-qsar"
  let row:unknown
  if(plan.tool==="run_chat_qsar"){
    row=await io.save(path,{...plan.args,id:actionId})
  }else{
    const {job_id,use_latest}=plan.args
    if(!((use_latest && !job_id)||(!use_latest && uuid.test(job_id))))throw Error("ระบุเลขงาน QSAR หรือขอผลล่าสุด")
    row=await io.read(path+"?job="+(use_latest?"latest":encodeURIComponent(job_id)))
    if(row===null && use_latest)return {text:"โปรเจกต์นี้ยังไม่มีงาน QSAR"}
  }
  if(!isJob(row) || (plan.tool==="run_chat_qsar" && row.id!==actionId) ||
    (plan.tool==="read_chat_qsar"&&!plan.args.use_latest&&row.id.toLowerCase()!==plan.args.job_id.toLowerCase()))
    throw Error("ยืนยันผลตอบกลับของงาน QSAR ไม่ได้")
  return {text:qsarReceipt(row),labLink:{target:"self_test" as const,project,id:row.id}}
}
