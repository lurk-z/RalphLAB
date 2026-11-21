export type LabSource = {
  id:string;
  title:string;
  url:string;
  provider:string;
  kind:"project"|"reference"|"paper"|"software";
  detail:string;
  coverage?:string;
  cited:boolean;
};

// This also applies to browser-restored messages created by older app versions.
export function labSourceHref(raw:unknown) {
  if(typeof raw!=="string" || raw.length>1300)return;
  if(/^\/api\/research\/(?:project\/[1-9]\d*|timed\/[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})\/files\/[a-zA-Z0-9-]+\/\d{1,2}$/i.test(raw))return raw;
  try {
    const url=new URL(raw);
    if(url.protocol==="https:"&&!url.username&&!url.password)return url.href;
  }catch { /* Ignore malformed legacy links. */ }
}
export function readLabSources(raw:unknown):LabSource[] {
  if(!Array.isArray(raw))return [];
  return raw.slice(0,14).flatMap(s=>{
    const url=labSourceHref(s?.url);
    if(!url || !/^S\d{1,2}$/.test(s.id)||typeof s.title!=="string"||typeof s.provider!=="string"||
       !["project","reference","paper","software"].includes(s.kind))return [];
    return [{id:s.id,title:s.title.slice(0,300),url,provider:s.provider.slice(0,80),kind:s.kind,
      detail:typeof s.detail==="string"?s.detail.slice(0,850):"",coverage:typeof s.coverage==="string"?s.coverage.slice(0,100):"",cited:s.cited===true}];
  });
}
export function readSourceNotices(raw:unknown):string[] {
  return Array.isArray(raw)?raw.filter((s):s is string=>typeof s==="string").slice(0,8).map(s=>s.slice(0,180)):[];
}
