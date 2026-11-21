import type {Case,StudyEvent} from "@/app/lab-room/orders/types";
import {readLabSources} from "./lab-sources";

// Called on the server with the authenticated project orders response.
export function extractOrderEvidence(rows:Case[]) {
  const found=new Map<string,{url:string;title:string;detail:string}>();
  function add(raw:string|undefined,name:string|undefined,detail?:string) {
    if(!raw||!name||found.size>=16)return;
    let url:URL;
    try{url=new URL(raw);}catch{return;}
    if(url.protocol!=="https:"||url.username||url.password||found.has(url.href))return;
    found.set(url.href,{url:url.href,title:name.slice(0,270),detail:(detail||"").slice(0,500)});
  }
  for(const row of rows.slice(0,12)){
    if("chat_sources" in row.request){
      for(const s of readLabSources(row.request.chat_sources))add(s.url,s.title,s.detail);
    }
    for(const e of (row.events as StudyEvent[]).slice(-12).reverse()){
      for(const s of e.sources_sent||[])add(s.url,s.title,s.locator);
      for(const s of e.result?.literature||[])add(s.url,s.title,s.application);
      for(const s of e.comparison_step?.sources||[])add(s.url,s.title,s.principle);
      if(e.structure)add(e.structure.url,"PDB "+e.structure.pdb,e.structure.application);
      for(const c of e.citations||[]){
        for(const s of c.evidence||[])add(s.url,s.source,[c.ingredient,s.reference].filter(Boolean).join(" · "));
        add(c.pubchem,"PubChem · "+c.ingredient,"อัตลักษณ์สารที่ระบุในใบงาน");
      }
    }
    if("stages" in row)for(const stage of row.stages)add(stage.source?.url,stage.source?.title,stage.application);
    if(found.size>=16)break;
  }
  return [...found.values()];
}
