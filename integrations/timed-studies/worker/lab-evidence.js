// Public search terms are selected locally. Study names, transcripts and uploaded
// excerpts never form part of requests to bibliographic or software providers.
const chatCatalog = {
  planning: {provider:"EPA", title:RESEARCH_ROLES.director.title, url:RESEARCH_ROLES.director.url, detail:"แผนคุณภาพข้อมูลสำหรับงานสิ่งแวดล้อม ระบุจุดประสงค์ แหล่งข้อมูล และเกณฑ์ประเมิน"},
  assay: {provider:"NCATS",title:RESEARCH_ROLES.researcher.title,url:RESEARCH_ROLES.researcher.url,detail:RESEARCH_ROLES.researcher.use},
  stability: {provider:"FDA / ICH",title:RESEARCH_ROLES.formulator.title,url:RESEARCH_ROLES.formulator.url,detail:"แนวทางความคงตัวของยา ใช้เทียบการจัดเก็บข้อมูลตามเวลา ต้องพิจารณาความเหมาะสมกับตัวอย่างเครื่องสำอาง"},
  precision: {provider:"FDA / ICH",title:RESEARCH_ROLES.analyst.title,url:"https://www.fda.gov/regulatory-information/search-fda-guidance-documents/q2r2-validation-analytical-procedures",detail:"หลักการตรวจสอบความถูกต้องและความเที่ยงของวิธีวิเคราะห์สำหรับยา"},
  measurement: {provider:"NIST",title:"Measurement Process Characterization",url:"https://www.itl.nist.gov/div898/handbook/mpc/mpc.htm",detail:"แยกความแปรปรวนของการวัด ความทำซ้ำได้ และความไม่แน่นอน"},
  identity: {provider:"PubChem",title:"Compound and Substance Records",url:"https://pubchem.ncbi.nlm.nih.gov/docs/compound-vs-substance",detail:"ใช้ CID ตรวจอัตลักษณ์โครงสร้าง สารที่จดทะเบียนไม่ได้ยืนยันความปลอดภัยของสูตร"},
  prediction: {provider:"OECD",title:"(Q)SAR Assessment Framework, Second Edition",url:"https://doi.org/10.1787/bbdac345-en",detail:"พิจารณา endpoint ขอบเขตการใช้โมเดลและข้อจำกัดในการตีความผลทำนายเฉพาะสาร"},
  gfp: {provider:"RCSB PDB",title:"1EMA · Green fluorescent protein",url:REF.models.gfp.source_url,detail:"พิกัด GFP ของโมเดลบนโต๊ะโปรตีน"},
  insulin: {provider:"RCSB PDB",title:"3I40 · Human insulin",url:REF.models.insulin.source_url,detail:"พิกัดอินซูลินของโมเดลเดี่ยวบนโต๊ะโปรตีน"},
  regularPair: {provider:"RCSB PDB",title:"1TRZ · Regular human insulin",url:REF.comparison.structures.find(s=>s.pdb==="1TRZ").source_url,detail:"พิกัดอินซูลินปกติในกรณีศึกษาเปรียบเทียบกับ lispro"},
  lispro: {provider:"RCSB PDB",title:"1LPH · Insulin lispro",url:REF.comparison.structures.find(s=>s.pdb==="1LPH").source_url,detail:"พิกัด insulin lispro ในกรณีศึกษาเปรียบเทียบกับอินซูลินปกติ"},
  transfer: {provider:"HSE",title:"Plant modification / Change procedures",url:"https://www.hse.gov.uk/comah/sragtech/techmeasplantmod.htm",detail:"ใช้ทบทวนการเปลี่ยนแปลงและผู้รับผิดชอบก่อนรับบันทึกการผลิตนำร่อง"},
  chemistryTools: {provider:"RDKit",title:"Molecular Descriptors",url:"https://www.rdkit.org/docs/source/rdkit.Chem.Descriptors.html",detail:"คู่มือเครื่องมือโอเพนซอร์สสำหรับอ่านชื่อและชนิดของ molecular descriptors ที่ใช้วิเคราะห์สาร"},
  colorTools: {provider:"Colour",title:"Colour Difference",url:"https://colour.readthedocs.io/en/latest/colour.difference.html",detail:"คู่มือเครื่องมือโอเพนซอร์สสำหรับคำนวณความแตกต่างของค่าสีที่บันทึกไว้"},
};
const roleCatalog = {
  director:["planning","measurement"], researcher:["assay","identity","measurement"],
  formulator:["stability","identity","prediction"], analyst:["precision","measurement","prediction"], evaluator:["planning","prediction","measurement"],
};
function roleReferences(role) {return (roleCatalog[role]||[]).map(key=>chatCatalog[key]);}
const evidenceSubjects=[
  {match:/qsar|ระคาย|irritation|sensitiz/i,refs:["prediction","identity"], software:"qsar",softwareRef:"chemistryTools",search:"cosmetic skin irritation prediction validation", terms:/irrita|cosmetic|QSAR/i},
  {match:/ไนอะซิน|ไนอาซิน|niacinamide|nicotinamide/i,refs:["identity","stability"],search:"topical niacinamide skin hydration",terms:/niacinamide|nicotinamide/i},
  {match:/กลีเซอร|กลีเซอรีน|glycer[oi]/i,refs:["identity","measurement"],search:"topical glycerol skin hydration measurement",terms:/glycerol|glycerin/i},
  {match:/คงตัว|เสถียร|stability|สกินแคร์|เครื่องสำอาง|เจลล้างมือ|skincare|hand ?wash|formulat|พัฒนาสูตร/i,refs:["stability","measurement"],search:"cosmetic formulation physical stability measurement",terms:/cosmetic|formulation|stability/i},
  {match:/ปนเปื้อน|สิ่งแวดล้อม|trace analysis|environmental monitoring|PFAS/i,refs:["planning","measurement","precision"],search:"environmental monitoring analytical measurement uncertainty",terms:/monitoring|uncertaint/i},
  {match:/สี|colour|colorimetr/i,refs:["measurement","precision"],software:"colorimetry",softwareRef:"colorTools",search:"colorimetry measurement repeatability",terms:/colou?r|repeatability/i},
  {match:/สอบเทียบ|ความเที่ยง|การวัด|วัดค่า|ความเป็นกรด|\bpH\b|calibrat|validation|precision/i,refs:["precision","measurement"],search:"analytical method validation measurement uncertainty",terms:/uncertaint|validation|precision/i},
  {match:/insulin|อินซูลิน|อินซุลิน|3i40|1trz|1lph|lispro|ลิสโปร/i,insulinDesk:true},
  {match:/\bGFP\b|1ema|green fluorescent protein|โปรตีนเรืองแสง/i,refs:["gfp"]},
  {match:/scale.up|ขยายขนาด|pilot plant|นำร่อง/i,refs:["transfer","measurement"],search:"process safety management of change documentation",terms:/safety|management of change/i},
  {match:/สังเคราะห์|สังเคราะ|synthesis/i,refs:["planning","measurement"],software:"electronic lab notebook",search:"electronic laboratory notebooks chemistry data provenance",terms:/notebook|provenance/i},
  {match:/ค้นคว้ายา|พัฒนายา|ตำรับยา|drug discovery/i,refs:["assay","stability","precision"],search:"assay data quality reproducibility reference standards",terms:/assay|reproducibility/i},
];
const evidenceRequest=/อ้างอิง|หลักฐาน|งานวิจัย|วรรณกรรม|บทความ|เปเปอร์|เอกสาร|ไฟล์|ค้นหา|แหล่งข้อมูล|source|research|evidence|paper|reference|literature|open[ -]?source/i;
const publicResearchRequest=/ค้น|หา(?:งานวิจัย|บทความ|เปเปอร์|หลักฐาน|แหล่ง|งานโอเพน)|จาก(?:เว็บ|เน็ต|เน็ท)|ออนไลน์|เพิ่มเติม|ไม่พอ|search|find|look up|open[ -]?source/i;
const navigateRequest=/^(?:ช่วย)?(?:เปิด|ไปที่|ไปหน้า|แสดงหน้า|open|show me)(?:\s*(?:หน้า|โต๊ะ))?\s*(?:ใบงาน|หน้า|ห้อง|งานติดตาม|โปรตีน|protein|self.test|project|orders|timed)/i;
const projectOnlyRequest=/เฉพาะ(?:เอกสาร|ไฟล์|คลัง|หลักฐาน|ข้อมูล|แหล่ง)(?:ใน|ที่อัป|ของโปรเจกต์)|(?:เอกสาร|ไฟล์|ข้อมูล|หลักฐาน)(?:ใน|ของ)โปรเจกต์เท่านั้น|only (?:my|project|uploaded)|project (?:sources|files) only/i;
const noPublicSearch=/(?:ไม่(?:ต้อง|ให้|อยาก)|ห้าม)(?:ไป)?(?:ค้น|หา|ใช้เว็บ)|do not search|don.t search|no web/i;
function evidenceText(v,n=500) {return typeof v==="string"?v.replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,n):"";}
function evidenceUrl(raw,project) {
  if(typeof raw!=="string"||raw.length>1300)return "";
  if(raw.startsWith("/"))return new RegExp("^/api/research/project/"+Number(project)+"/files/[a-zA-Z0-9-]+/\\d{1,2}$").test(raw)?raw:"";
  try {const u=new URL(raw);return u.protocol==="https:"&&!u.username&&!u.password?u.href:"";}catch{return "";}
}
function dedupeChatSources(sources) {
  const result=[],seen=new Set();
  for(const s of sources){
    if(!s.title||!s.url)continue;
    const key=(s.doi?s.doi:s.url.replace(/^https:\/\/(?:dx\.)?doi\.org\//i,"")).toLowerCase().replace(/\/$/,"");
    if(!seen.has(key)){seen.add(key);result.push(s);}
  }
  return result;
}
async function pmcEvidence(query) {
  const url=new URL("https://www.ebi.ac.uk/europepmc/webservices/rest/search");
  url.search=new URLSearchParams({query,format:"json",pageSize:"4",resultType:"core"}).toString();
  const rows=(await sourceJSON(url))?.resultList?.result||[];
  return rows.flatMap(p=>{
    const pmid=/^\d{1,10}$/.test(p.pmid||"")?p.pmid:"", doi=/^10\.\d{4,9}\/\S+$/i.test(p.doi||"")?p.doi:"";
    if(!pmid&&!doi)return [];
    return [{kind:"paper",provider:"Europe PMC",title:evidenceText(p.title,270),doi,
      url:pmid?"https://pubmed.ncbi.nlm.nih.gov/"+pmid+"/":"https://doi.org/"+doi,
      detail:[p.pubYear, p.journalInfo?.journal?.title,evidenceText(p.abstractText,480)].filter(Boolean).join(" · "),
      coverage:p.abstractText?"ข้อความบางส่วนจากบทคัดย่อ":"ข้อมูลบรรณานุกรม"}];
  });
}
async function chatResearchSearch(subject,software) {
  const providers=[["Europe PMC",pmcEvidence(subject.search)],["Crossref",paperMatches(subject.search)]];
  if(software)providers.push(["GitHub",softwareMatches(subject.software||subject.search)]);
  const results=await Promise.allSettled(providers.map(p=>p[1]));
  const sources=[],notices=[],unavailable=[];
  for(let i=0;i<results.length;i++){
    const result=results[i],provider=providers[i][0];
    if(result.status!=="fulfilled"){unavailable.push(provider);notices.push("ค้น "+provider+" ไม่สำเร็จในรอบนี้");continue;}
    const matches=provider==="GitHub"?result.value:result.value.filter(s=>subject.terms.test(s.title+" "+(s.detail||"")));
    if(!matches.length)notices.push(provider+" ไม่พบรายการที่ตรงกับหัวข้อ");
    for(const item of matches.slice(0,2)){
      sources.push({kind:item.kind,provider,title:evidenceText(item.title,270),url:evidenceUrl(item.url),detail:evidenceText(item.detail,550),
        coverage:item.coverage||(item.kind==="software"?"ข้อมูลโครงการและสัญญาอนุญาต":"ข้อมูลบรรณานุกรม"),
        doi:item.doi||(item.id?.startsWith("doi:")?item.id.slice(4):"")});
    }
  }
  return {sources:dedupeChatSources(sources),notices,unavailable,providers:providers.map(p=>p[0])};
}
// Rank decisions across all earlier runs before limiting so an older saved
// approval cannot win over a newer dismissal of the same source.
async function reviewedChatEvidence(db,user,scope) {
  const rows=await db.prepare(`WITH reviews AS (
    SELECT s.value AS source, row_number() OVER (
      PARTITION BY json_extract(s.value,'$.id') ORDER BY json_extract(s.value,'$.review.at') DESC,r.created DESC,r.id DESC
    ) AS rank FROM research_runs r,json_each(r.payload,'$.sources') s
    WHERE r.owner=? AND r.scope=? AND r.revision>0 AND json_extract(r.payload,'$.status')='done'
      AND json_extract(s.value,'$.review.decision') IN ('use','dismiss')
  ) SELECT source FROM reviews WHERE rank=1 AND json_extract(source,'$.review.decision')='use'
    ORDER BY json_extract(source,'$.review.at') DESC LIMIT 12`).bind(user,scope).all();
  return rows.results.map(r=>JSON.parse(r.source));
}
async function archiveChatLookup(db,user,project,b,subject,result) {
  const id=uuid(b.id), scope="project/"+project;
  const run={id,kind:"chat_search",gap:evidenceText(b.question,650),role:b.role,at:Date.now(),status:"done",
    baseline:RESEARCH_ROLES[b.role],paper:subject.search,software:subject.software||subject.search,providers:result.providers,
    topic:researchTopic(b.question,"")[1],unavailable:result.unavailable,prior:[],sources:result.sources.map(s=>({
      ...s,id:s.doi?"doi:"+s.doi:s.url,
    }))};
  await db.prepare("INSERT INTO research_runs(id,owner,scope,created,revision,payload) VALUES(?,?,?,?,1,?) ON CONFLICT(id) DO NOTHING")
    .bind(id,user,scope,run.at,JSON.stringify(run)).run();
}
async function collectLabEvidence(env,b,scope={}) {
  const question=evidenceText(b.question,4000), asks=evidenceRequest.test(question);
  const deskSubject=/insulin|อินซูลิน|อินซุลิน|lispro|ลิสโปร|3i40|1trz|1lph|1ema|\bGFP\b|green fluorescent protein|โปรตีนเรืองแสง/i.test(question);
  if(navigateRequest.test(question)&&!asks&&!deskSubject)return {sources:[],notices:[]};
  const recent=(Array.isArray(b.history)?b.history:[]).filter(m=>m?.role==="user").slice(-2).map(m=>evidenceText(m.text,600)).join(" ");
  const matches=evidenceSubjects.filter(s=>s.match.test(question));
  const subjects=matches.length?matches:asks?evidenceSubjects.filter(s=>s.match.test(recent)):[];
  const interpret=/ทำไม|วิเคราะห์|เปรียบเทียบ|ประเมิน|อธิบาย|ออกแบบ|ความเสี่ยง|เทียบ|ควร|เหตุผล|why|compare|explain|interpret/i.test(question)
    || deskSubject&&/เปิด|วาง|จัดแนว|ศึกษา|ดู|open|align|inspect|show/i.test(question);
  const intake=/สร้าง|ออกใบงาน|จัดทำ|วางแผน|เปิดใบงาน|เตรียม|ตั้งรอบ|create|plan|start|schedule/i.test(question);
  if(!asks&&(!subjects.length||!(interpret||intake)))return {sources:[],notices:[]};
  const notices=[];
  let reviewed=[];
  if(scope.user&&Number.isSafeInteger(scope.project)){
    try{reviewed=await reviewedChatEvidence(env.DB,scope.user,"project/"+scope.project);}
    catch{notices.push("อ่านคลังเอกสารของโปรเจกต์ไม่สำเร็จ");}
  }
  const workId=(question+" "+recent).match(/\b[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\b/i)?.[0];
  if(workId&&scope.timedOwner){
    const timedScope="timed/"+workId.toLowerCase();
    try {
      const exists=await env.DB.prepare("SELECT id FROM timed_studies WHERE id=? AND owner=?").bind(workId.toLowerCase(),scope.timedOwner).first();
      if(exists)reviewed.push(...(await reviewedChatEvidence(env.DB,scope.timedOwner,timedScope)).map(s=>({...s,timedScope})));
    }catch{notices.push("อ่านหลักฐานของใบงานติดตามไม่สำเร็จ");}
  }
  const supportingUrls=new Set(reviewed.filter(s=>[s.excerpt,s.review?.note,s.coverage==="ข้อความบางส่วนจากบทคัดย่อ"?s.detail:""]
    .some(text=>evidenceText(text).length>=30)).map(s=>evidenceUrl(s.url,scope.project)||s.url));
  let projectSources=reviewed.map(s=>({kind:"project",provider:s.timedScope?"ใบงานติดตาม":"คลังโปรเจกต์",title:evidenceText(s.title,270),
    url:s.timedScope&&new RegExp("^/api/research/"+s.timedScope+"/files/[a-zA-Z0-9-]+/\\d{1,2}$").test(s.url) ? (scope.native?"":s.url) : evidenceUrl(s.url,scope.project),
    detail:[s.locator,s.review?.note,s.excerpt||s.detail].map(t=>evidenceText(t,350)).filter(Boolean).join(" · ").slice(0,850),
    coverage:s.excerpt?"ข้อความที่ยกมาและบันทึกของทีม":"บันทึกที่ทีมทบทวน"}));
  if(scope.native && Array.isArray(b.orderEvidence)){
    for(const s of b.orderEvidence.slice(0,16)){
      if(s && typeof s==="object")projectSources.push({kind:"project",provider:"ใบงานโปรเจกต์",title:evidenceText(s.title,270),
        url:evidenceUrl(s.url),detail:evidenceText(s.detail),coverage:"แหล่งที่บันทึกในใบงาน"});
    }
  }
  for(const row of (scope.orders||[]).slice(0,8)){
    const snapshot=Array.isArray(row.request?.chat_sources)?row.request.chat_sources:[];
    for(const s of snapshot.slice(0,14)){
      if(!s||typeof s!=="object")continue;
      if(s.coverage==="ข้อความบางส่วนจากบทคัดย่อ"&&evidenceText(s.detail).length>=30)supportingUrls.add(evidenceUrl(s.url,scope.project));
      projectSources.push({kind:"project",provider:evidenceText(s.provider,80)||"ใบงานโปรเจกต์",title:evidenceText(s.title,270),
        url:evidenceUrl(s.url,scope.project),detail:evidenceText(s.detail),coverage:s.cited?"อ้างในใบงานก่อนหน้า":"แนบกับใบงานก่อนหน้า"});
    }
    for(const e of (row.events||[]).slice(-12).reverse()){
      const sources=[...(e.sources_sent||[]),...(e.result?.literature||[]),...(e.comparison_step?.sources||[])];
      if(e.structure)sources.push({url:e.structure.url,title:"PDB "+e.structure.pdb,application:e.structure.application});
      for(const s of sources){
        projectSources.push({kind:"project",provider:"ใบงานโปรเจกต์",title:evidenceText(s.title,270),url:evidenceUrl(s.url),
          detail:evidenceText(s.application||s.principle||s.locator),coverage:"แหล่งที่บันทึกในใบงาน"});
      }
    }
  }
  projectSources=dedupeChatSources(projectSources);
  // Match the order's subject or a named file first. For inventory questions
  // keep the recent sources instead of arbitrarily selecting one document.
  if(subjects.length){
    const related=projectSources.filter(s=>subjects.some(t=>t.match.test(s.title+" "+s.detail))||question.toLowerCase().includes(s.title.toLowerCase()));
    projectSources=related;
  }
  const subjectText=matches.length?question:recent;
  const references=subjects.length ? [...new Set(subjects.flatMap(s=>{
    if(!s.insulinDesk)return s.refs;
    const pair=/1trz|1lph|lispro|ลิสโปร/i.test(subjectText);
    if(!pair)return ["insulin"];
    return /3i40/i.test(subjectText)?["insulin","regularPair","lispro"]:["regularPair","lispro"];
  }))].map(k=>chatCatalog[k]) : roleReferences(b.role);
  const subject=subjects.find(s=>s.search);
  const askOnline=publicResearchRequest.test(question);
  const useProjectOnly=projectOnlyRequest.test(question);
  const localOnly=useProjectOnly||noPublicSearch.test(question);
  // A link, title or repeated order citation cannot corroborate a finding.
  const supportingCount=projectSources.filter(s=>supportingUrls.has(s.url)).length;
  const allowSearch=!localOnly&&(askOnline || (asks||interpret)&&supportingCount<2);
  let found=[];
  if(subject && allowSearch){
    const software=/ซอฟต์แวร์|เครื่องมือ|โอเพนซอร์ส|โอเพ่นซอร์ส|open[ -]?source|github/i.test(question);
    const result=await chatResearchSearch(subject,software);
    if(software&&subject.softwareRef)references.push(chatCatalog[subject.softwareRef]);
    found=result.sources;notices.push(...result.notices);
    if(scope.user&&Number.isSafeInteger(scope.project)&&b.id){
      try {await archiveChatLookup(env.DB,scope.user,scope.project,b,subject,result);}
      catch {notices.push("บันทึกการค้นลงคลังโปรเจกต์ไม่สำเร็จ");}
    }
  }else if(askOnline && !subject && !localOnly){
    notices.push("ยังไม่ได้ค้นภายนอก ระบุหัวข้อ เช่น ความคงตัวของสูตร การวัดสี หรือความเที่ยงของวิธีวิเคราะห์");
  }
  const sources=dedupeChatSources([...projectSources.slice(0,5),...(useProjectOnly?[]:references.slice(0,4)).map(r=>({...r,kind:"reference",coverage:"สรุปขอบเขตจากทะเบียนเอกสาร"})),...found]).slice(0,14);
  if(useProjectOnly&&!projectSources.length)notices.push("ยังไม่มีแหล่งที่ทีมเลือกใช้ในคลังโปรเจกต์นี้");
  return {sources:sources.map((s,i)=>({id:"S"+(i+1),...s})),notices};
}
function attachLabEvidence(plan,bundle) {
  if(!bundle.sources.length&&!bundle.notices.length)return plan;
  if(plan.tool==="show_tool")return plan;
  const text=[plan,...(plan.actions||[])].map(a=>[a.answer,a.args?.draft,a.args?.brief,a.args?.notes,a.args?.evidence,a.args?.finding]
    .filter(s=>typeof s==="string").join(" ")).join(" ");
  const ids=new Set(Array.from(text.matchAll(/\[(S\d+)\]/g),m=>m[1]));
  return {...plan,sources:bundle.sources.map(({doi,...s})=>({...s,cited:ids.has(s.id)})),sourceNotices:bundle.notices};
}
