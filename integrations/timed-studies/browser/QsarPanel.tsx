import { useEffect, useRef, useState } from "react";

type Mix = {cid:number; percent:number};
type Outcome = {label_th:string;peak_score:number;band:string;confidence:string;in_domain:boolean;model_versions:string[]};
export type QsarJob = {id:string;state:string;issue:string|null;report:string|null;tool_called:boolean;mode:string;
  formula:{region:string;ingredients:Mix[]};
  result:{engine:string;endpoints:Record<string,Outcome>;ingredients:{cid:number;name:string;percent:number}[]}|null};
type Job = QsarJob;
const path="/api/lab/qsar";
const states:Record<string,string>={preparing:"กำลังขอให้ OpenAI เรียกเครื่องมือ",queued:"รอเครื่องคำนวณของ RalphLAB",running:"กำลังรันโมเดล QSAR",complete:"คำนวณเสร็จแล้ว",failed:"คำนวณไม่สำเร็จ"};
async function request(url:string,body?:object) {
  const r=await fetch(url,{cache:"no-store",...(body&&{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)})});
  const data=await r.json(); if(!r.ok) throw Error(data.detail||"เปิดงาน QSAR ไม่สำเร็จ"); return data;
}
export default function QsarPanel({study}:{study:string}) {
  const [ingredients,setIngredients]=useState([{cid:"753",percent:"5"}]),[region,setRegion]=useState("forearm");
  const [job,setJob]=useState<Job|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const [older,setOlder]=useState<Job[]>([]);
  const last=useRef({key:"",id:""}), alive=useRef(true), sending=useRef(false);
  useEffect(()=>{alive.current=true; let active=true;
    request(path+(study?"?study="+encodeURIComponent(study):"")).then((rows:Job[])=>{if(active&&!last.current.id){setOlder(rows);setJob(rows[0]||null)}}).catch(e=>{if(active)setError(e.message)});
    return ()=>{active=false;alive.current=false};
  },[study]);
  const waiting=Boolean(job && (["preparing","queued","running"].includes(job.state)||(job.state==="complete"&&job.tool_called&&!job.report&&!job.issue)));
  useEffect(()=>{if(!waiting||!job)return;let active=true,timer:ReturnType<typeof setTimeout>;
    async function poll(){try{const next=await request(path+"/"+job!.id); if(active){setJob(next);setError("")}}catch(e){if(active)setError((e as Error).message)}finally{if(active)timer=setTimeout(poll,3000)}}
    timer=setTimeout(poll,2000);return ()=>{active=false;clearTimeout(timer)};
  },[job?.id,waiting]);
  async function run(mode:"model"|"agent") {
    if(sending.current)return; sending.current=true;setBusy(true);setError("");
    const body={mode,study:study||null,region,ingredients:ingredients.map(i=>({cid:Number(i.cid),percent:Number(i.percent)}))};
    const key=JSON.stringify(body); if(last.current.key!==key) last.current={key,id:crypto.randomUUID()};
    try{const row:Job=await request(path,{...body,id:last.current.id});if(alive.current){setJob(row);setOlder(v=>[row,...v.filter(i=>i.id!==row.id)].slice(0,10));last.current={key:"",id:""}}}
    catch(e){if(alive.current)setError((e as Error).message)}finally{sending.current=false;if(alive.current)setBusy(false)}
  }
  return <section><h2>ประเมินสูตรด้วย QSAR</h2>
    <p>เลือกสารจากทะเบียนด้วย PubChem CID เช่น 753 สำหรับกลีเซอริน หรือ 936 สำหรับไนอะซินาไมด์ ระบบส่งเฉพาะรายการสาร สัดส่วน และบริเวณที่เลือกให้เครื่องคำนวณของ RalphLAB</p>
    <form onSubmit={e=>{e.preventDefault();void run("model")}}>
      {ingredients.map((item,index)=><div key={index}>
        <label>PubChem CID <input type="number" min="1" step="1" required value={item.cid} onChange={e=>setIngredients(ingredients.map((r,i)=>i===index?{...r,cid:e.target.value}:r))}/></label>
        <label>สัดส่วน (%) <input type="number" min="0.00001" max="100" step="any" required value={item.percent} onChange={e=>setIngredients(ingredients.map((r,i)=>i===index?{...r,percent:e.target.value}:r))}/></label>
        {ingredients.length>1&&<button type="button" onClick={()=>setIngredients(ingredients.filter((_,i)=>i!==index))}>เอารายการนี้ออก</button>}
      </div>)}
      <button type="button" disabled={ingredients.length>=20} onClick={()=>setIngredients([...ingredients,{cid:"",percent:""}])}>เพิ่มส่วนผสม</button>
      <label>บริเวณประเมิน <select value={region} onChange={e=>setRegion(e.target.value)}>
        <option value="forearm">ท้องแขน</option><option value="hand">มือ</option><option value="face">ใบหน้า</option><option value="eye">รอบดวงตา</option>
      </select></label>
      <button type="submit" disabled={busy||waiting}>รัน QSAR โดยตรง</button>{" "}
      <button type="button" disabled={busy||waiting} onClick={e=>{if(e.currentTarget.form?.reportValidity())void run("agent")}}>ให้ OpenAI เรียก QSAR และสรุปผล</button>
    </form>
    {error&&<p role="alert">{error}</p>}
    {older.length>1&&<label>งานล่าสุด <select value={job?.id||""} onChange={async e=>{try{setJob(await request(path+"/"+e.target.value))}catch(err){setError((err as Error).message)}}}>{older.map(j=><option key={j.id} value={j.id}>{j.id.slice(0,8)} · {j.formula.ingredients.map(i=>i.cid+" ("+i.percent+"%)").join(" + ")}</option>)}</select></label>}
    {job&&<article><h3>ผลการประเมิน</h3><p role="status">{states[job.state]} · {job.id.slice(0,8)} · {job.formula.ingredients.map(i=>i.cid+" ("+i.percent+"%)").join(" + ")}</p>
      {job.issue&&<p role="alert">{job.issue}</p>}
      {job.result&&<><p>{job.result.engine} · {job.result.ingredients.map(i=>i.name).join(" + ")}</p><ul>{Object.entries(job.result.endpoints).map(([ep,r])=><li key={ep}><strong>{r.label_th}</strong> · {r.peak_score}/100 · ความเชื่อมั่น {r.confidence} · {r.in_domain?"อยู่":"อยู่นอก"}ขอบเขตโมเดล</li>)}</ul>
        <small>คะแนนคัดกรองจากแบบจำลอง ค่าที่วัดจากการทดลองบันทึกแยกในรอบสังเกต</small></>}
      {job.tool_called&&<p>OpenAI เรียกเครื่องมือ run_formula_qsar แล้ว</p>}
      {job.report&&<><h3>รายงานจาก OpenAI</h3><p style={{whiteSpace:"pre-wrap"}}>{job.report}</p></>}
    </article>}
  </section>;
}
