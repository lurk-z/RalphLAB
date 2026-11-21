"use client";
import {useEffect,useState} from "react";
import {http} from "@/lib/api";
import {applyQsarPlan} from "@/lib/lab-room/qsar-chat-tools";

export default function ChatQsarResult({project,id}:{project:number;id:string}) {
  const [message,setMessage]=useState("กำลังโหลดผล QSAR…"),[error,setError]=useState("");
  useEffect(()=>{
    const ctrl=new AbortController();
    let timer:ReturnType<typeof setTimeout>;
    async function refresh(){
      try{
        let pending=false;
        const reply=await applyQsarPlan({tool:"read_chat_qsar",args:{job_id:id,use_latest:false}},project,id,{
          save:async()=>{throw Error("หน้ารายงานใช้สำหรับอ่านผล");},
          read:async(path)=>{
            const row=await http<{state:string}>(path,{signal:ctrl.signal});
            pending=["preparing","queued","running"].includes(row.state);
            return row;
          },
        });
        if(ctrl.signal.aborted)return;
        setMessage(reply.text);setError("");
        if(pending)timer=setTimeout(refresh,3500);
      }catch(e){if(!ctrl.signal.aborted)setError(e instanceof Error?e.message:"เปิดงานประเมินไม่ได้");}
    }
    void refresh();return ()=>{ctrl.abort();clearTimeout(timer);};
  },[project,id]);
  return <main className="mx-auto grid max-w-2xl gap-4 p-6">
    <a className="text-teal-800 underline" href={"/lab-room?project="+project}>กลับห้องแล็บ</a>
    <h1 className="text-2xl font-semibold">ผลประเมินสูตรจากแชต</h1>
    {error?<p role="alert">{error}</p>:<p className="whitespace-pre-line rounded-xl border p-4" aria-live="polite">{message}</p>}
    <a className="text-teal-800 underline" href={"/assess?tab=assess&projectId="+project}>เปิด Studio เพื่อสร้างสูตร</a>
  </main>;
}
