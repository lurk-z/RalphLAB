import {readLabSources,readSourceNotices,type LabSource} from "@/lib/lab-room/lab-sources";
export default function LabChatSources({sources,notices}:{sources?:LabSource[];notices?:string[]}) {
  const rows=readLabSources(sources), status=readSourceNotices(notices);
  if(!rows.length&&!status.length)return null;
  function list(items:LabSource[]){
    return <ul className="my-1 space-y-1 pl-1">{items.map(s=><li key={s.id}>
      <a className="font-medium text-teal-800 underline" href={s.url} target="_blank" rel="noreferrer">[{s.id}] {s.title}</a>
      <span className="text-slate-600"> · {s.provider} · {s.coverage||"เอกสารอ้างอิง"}</span>
      {s.detail&&<p className="mt-0.5 break-words text-slate-700">{s.detail}</p>}
    </li>)}</ul>;
  }
  const cited=rows.filter(s=>s.cited),other=rows.filter(s=>!s.cited);
  return <div className="my-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5">
    {!!cited.length&&<><strong>อ้างในคำตอบ ({cited.length})</strong>{list(cited)}</>}
    {!!other.length&&<details><summary className="cursor-pointer text-teal-800">แหล่งอื่นที่ส่งให้ Agent ({other.length})</summary>{list(other)}</details>}
    {status.map(s=><p key={s} className="text-slate-600">{s}</p>)}
  </div>;
}
