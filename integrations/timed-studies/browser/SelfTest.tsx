import { Component, Suspense, lazy, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Eraser, Paintbrush, Plus, Trash2 } from "lucide-react";
import { useSession } from "./src-shims/session";
import type { QsarJob } from "./QsarPanel";
import type { PaintMaskSnapshot } from "@/lib/project-workspace";
import "./self-test.css";

const Face = lazy(() => import("@/components/face/SymptomFaceCanvas"));
const endpointColors:Record<string,string> = {skin:"#e15555",eye:"#e68a41",sens:"#b6569c",acute:"#7f71b3",skin_dryness:"#369cad"};
class ModelBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed ? <p role="alert">เปิดโมเดล 3D ไม่สำเร็จ กรุณาเปิด WebGL แล้วโหลดหน้าอีกครั้ง</p> : this.props.children;}
}
type Item = {cid:string;percent:string};
const empty = ():Item[] => [{cid:"",percent:""}];
export default function SelfTest() {
  const session=useSession(), project=session.data?.project?.id, viewer=session.data?.user?.id;
  const [items,setItems]=useState<Item[]>(empty), [region,setRegion]=useState("face");
  const [job,setJob]=useState<QsarJob|null>(null), [recent,setRecent]=useState<QsarJob[]>([]);
  const [busy,setBusy]=useState(false), [error,setError]=useState(""), [erase,setErase]=useState(false);
  const [size,setSize]=useState(50), [clear,setClear]=useState(0);
  const [stroke,setStroke]=useState<{key:string;mask:PaintMaskSnapshot}|null>(null);
  const requestId=useRef({signature:"",id:""}), submitting=useRef(false);
  const ingredients=items.map(i=>({cid:Number(i.cid),percent:Number(i.percent)}));
  const signature=JSON.stringify({region,ingredients});
  const valid=ingredients.every(i=>Number.isSafeInteger(i.cid)&&i.cid>0&&i.percent>0&&i.percent<=100)
    && new Set(ingredients.map(i=>i.cid)).size===items.length && ingredients.reduce((s,i)=>s+i.percent,0)<=100.0001;
  const selected=job && JSON.stringify({region:job.formula.region,ingredients:job.formula.ingredients})===signature ? job : null;
  const result=selected?.state==="complete" ? selected.result : null;
  const paintKey=JSON.stringify([viewer,project,signature]);
  const initialMask=useMemo(()=>{
    try {return JSON.parse(localStorage.getItem("ralphlab:face:"+paintKey)||"null") as PaintMaskSnapshot|null;}
    catch {return null;}
  },[paintKey]);
  const mask=stroke?.key===paintKey ? stroke.mask : initialMask;
  useEffect(()=>setErase(false),[paintKey]);
  function savePaint(value:PaintMaskSnapshot){
    setStroke({key:paintKey,mask:value});
    try {if(value.hasPaint)localStorage.setItem("ralphlab:face:"+paintKey,JSON.stringify(value));else localStorage.removeItem("ralphlab:face:"+paintKey);} catch { /* Keep the paint in memory if storage is full. */ }
  }
  async function request(path:string,signal?:AbortSignal,body?:object) {
    const response=await fetch("/api/lab/qsar"+path,{method:body?"POST":"GET",signal,cache:"no-store",
      headers:{"content-type":"application/json","x-ralphlab-project":String(project)},body:body?JSON.stringify(body):undefined});
    const data=await response.json();
    if(!response.ok)throw Error(data.detail||"เปิดงานประเมินไม่ได้");
    return data;
  }
  useEffect(()=>{
    if(!project)return;
    const ctrl=new AbortController();
    request("",ctrl.signal).then(setRecent).catch(e=>{if(!ctrl.signal.aborted)setError(e.message);});
    return ()=>ctrl.abort();
  },[project]);
  const waiting=!!job && ["preparing","queued","running"].includes(job.state);
  useEffect(()=>{
    if(!waiting||!job||!project)return;
    const ctrl=new AbortController();
    let timer:ReturnType<typeof setTimeout>;
    async function poll(){
      try {const next:QsarJob=await request("/"+job!.id,ctrl.signal);
        if(!ctrl.signal.aborted){setJob(next);setRecent(rows=>[next,...rows.filter(r=>r.id!==next.id)].slice(0,10));setError("");}
      } catch(e){if(!ctrl.signal.aborted)setError((e as Error).message);}
      finally {if(!ctrl.signal.aborted)timer=setTimeout(poll,2500);}
    }
    timer=setTimeout(poll,1500);
    return ()=>{ctrl.abort();clearTimeout(timer);};
  },[job?.id,waiting,project]);
  async function run(){
    if(!valid||submitting.current||!project)return;
    submitting.current=true;setBusy(true);setError("");
    if(requestId.current.signature!==signature)requestId.current={signature,id:crypto.randomUUID()};
    try {
      const saved:QsarJob=await request("",undefined,{region,ingredients,id:requestId.current.id,mode:"model",study:null});
      setJob(saved);setRecent(rows=>[saved,...rows.filter(r=>r.id!==saved.id)].slice(0,10));
      requestId.current={signature:"",id:""};
    } catch(e){setError((e as Error).message);}
    finally {submitting.current=false;setBusy(false);}
  }
  function edit(index:number,key:keyof Item,value:string){setItems(rows=>rows.map((r,i)=>i===index?{...r,[key]:value}:r));}
  const layers=Object.entries(result?.endpoints||{}).flatMap(([key,r])=>Number.isFinite(r.peak_score)?
    [{key,label:r.label_th,score:r.peak_score,band:r.band,color:endpointColors[key]||"#328982"}]:[]);
  if(!project)return <main className="st-page"><a href="/projects">เลือกโปรเจกต์เพื่อเปิดการทดสอบสาร</a></main>;
  return <main className="st-page" lang="th">
    <header><a href={"/lab-room?project="+project}><ArrowLeft size={17}/>กลับห้องแล็บ</a><span>{session.data?.project?.name}</span></header>
    <h1>ทดสอบสารด้วยตัวเอง</h1>
    <div className="st-layout"><section className="st-form">
      <h2>สร้างสูตร</h2>
      <form onSubmit={e=>{e.preventDefault();void run();}}>
        <fieldset disabled={busy}><legend>ส่วนผสม</legend>
          {items.map((r,i)=><div className="st-row" key={i}>
            <label>PubChem CID<input type="number" required min="1" step="1" placeholder="เช่น 753" value={r.cid} onChange={e=>edit(i,"cid",e.target.value)}/></label>
            <label>สัดส่วน (%)<input type="number" required min="0.00001" max="100" step="any" value={r.percent} onChange={e=>edit(i,"percent",e.target.value)}/></label>
            <button type="button" aria-label={"ลบสารลำดับ "+(i+1)} disabled={items.length===1} onClick={()=>setItems(items.filter((_,j)=>i!==j))}><Trash2 size={15}/></button>
          </div>)}
          <button type="button" disabled={items.length>=20} onClick={()=>setItems([...items,...empty()])}><Plus size={15}/>เพิ่มสาร</button>
          <label>บริเวณประเมิน<select value={region} onChange={e=>setRegion(e.target.value)}><option value="face">ใบหน้า</option><option value="eye">รอบดวงตา</option></select></label>
        </fieldset>
        <button className="st-primary" disabled={!valid||busy||waiting}>{busy?"กำลังส่งสูตร":waiting?"กำลังรอผล QSAR":"ประเมินสูตรด้วย QSAR"}</button>
      </form>
      {error&&<p role="alert">{error}</p>}
      {recent.some(j=>["face","eye"].includes(j.formula.region))&&<label>เปิดสูตรที่เคยส่ง<select value={selected?.id||""} disabled={busy} onChange={e=>{
        const saved=recent.find(j=>j.id===e.target.value);if(!saved)return;
        setJob(saved);setRegion(saved.formula.region);setItems(saved.formula.ingredients.map(i=>({cid:String(i.cid),percent:String(i.percent)})));
      }}><option value="">เลือกใบงาน</option>{recent.filter(j=>["face","eye"].includes(j.formula.region)).map(j=><option key={j.id} value={j.id}>{j.formula.ingredients.map(i=>i.cid+" · "+i.percent+"%").join(" + ")} ({j.id.slice(0,8)})</option>)}</select></label>}
      {selected&&<div aria-live="polite"><h2>ผลการประเมิน</h2>
        {selected.issue&&<p>{selected.issue}</p>}
        {result?<><p>{result.ingredients.map(i=>i.name).join(" + ")}</p><ul>{Object.entries(result.endpoints).map(([k,r])=><li key={k}>{r.label_th} <b>{r.peak_score}/100</b><small>ความเชื่อมั่น {r.confidence} · {r.in_domain?"อยู่ใน":"อยู่นอก"}ขอบเขตโมเดล</small></li>)}</ul></>:<p>{{queued:"รอเครื่องคำนวณ",preparing:"กำลังเตรียมงาน",running:"กำลังคำนวณ",failed:"การประเมินไม่สำเร็จ"}[selected.state]||selected.state}</p>}
      </div>}
    </section><section className="st-view"><div className="st-canvas"><ModelBoundary><Suspense fallback={<p>กำลังโหลดโมเดลใบหน้า…</p>}>
      <Face paintOwnerKey={paintKey} productName={result?.ingredients.map(i=>i.name).join(" + ")||"สูตรที่เลือก"} layers={layers} armed={valid}
        revealResults={!!result} eraseMode={erase} clearPaintRequest={clear} brushSizePct={size} initialPaint={mask} onPaintChange={savePaint}/>
    </Suspense></ModelBoundary></div>
    <div className="st-controls"><button disabled={!valid} aria-pressed={!erase} onClick={()=>setErase(false)}><Paintbrush size={16}/>ระบาย</button>
      <button disabled={!valid} aria-pressed={erase} onClick={()=>setErase(true)}><Eraser size={16}/>ลบ</button>
      <label>ขนาดแปรง<input aria-label="ขนาดแปรง" type="range" min="10" max="100" value={size} onChange={e=>setSize(Number(e.target.value))}/></label>
      <button disabled={!mask?.hasPaint} onClick={()=>setClear(n=>n+1)}>ล้างรอยทั้งหมด</button></div>
    <p>ใส่ส่วนผสมแล้วลากแปรงบนใบหน้า เมื่อ QSAR คำนวณเสร็จ บริเวณที่ระบายจะแสดงผลทำนายของสูตร</p>
    </section></div></main>;
}
