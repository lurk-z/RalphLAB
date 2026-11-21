"use client";
import {useEffect,useState} from "react";
type Study={id:string;brief:string;metric:string;unit:string;goal:string;condition:string;state:string;rounds:{hour:number;due:number;result?:{value:number;source:string}}[]};
export default function TimedReadout({project,id}:{project:number;id?:string}) {
  const [rows,setRows]=useState<Study[]>([]),[error,setError]=useState(""),[loading,setLoading]=useState(true);
  useEffect(()=>{
    const ctrl=new AbortController();
    async function load(){
      try{
        const res=await fetch("/api/timed"+(id?"/"+encodeURIComponent(id):""),{cache:"no-store",headers:{"x-ralphlab-project":String(project)},signal:ctrl.signal});
        const data=await res.json();
        if(!res.ok)throw Error(data.detail||"เปิดใบงานไม่ได้");
        setRows(id?[data.row]:data);setError("");
      }catch(e){if(!ctrl.signal.aborted)setError((e as Error).message);}
      finally{if(!ctrl.signal.aborted)setLoading(false);}
    }
    void load();const timer=setInterval(load,30000);
    return ()=>{ctrl.abort();clearInterval(timer);};
  },[id,project]);
  return <main className="mx-auto grid max-w-3xl gap-4 p-6"><a href={"/lab-room?project="+project}>กลับห้องแล็บ</a><h1 className="text-2xl font-semibold">งานติดตามตามเวลา</h1>
    {error&&<p role="alert">{error}</p>}{loading&&<p>กำลังโหลดใบงาน…</p>}{!error&&!loading&&!rows.length&&<p>ยังไม่มีใบงานติดตาม</p>}
    {rows.map(r=><article key={r.id} className="grid gap-2 rounded-xl border p-4"><a className="font-semibold underline" href={`/lab-room/timed?project=${project}&id=${r.id}`}>{r.brief}</a>
      <p>{r.goal} · {r.condition}</p>{id&&<ul>{r.rounds.map(q=><li key={q.due}>{q.hour} ชั่วโมง · {new Date(q.due).toLocaleString("th-TH")} · {r.metric} · {q.result?q.result.value+" "+r.unit+" · "+q.result.source:"รอบันทึกผล"}</li>)}</ul>}</article>)}
  </main>;
}
