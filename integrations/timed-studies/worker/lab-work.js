// Scientific work orders track documents and the team's observations. They do not operate equipment.
const workDisciplines=["synthesis","discovery","stability","trace","validation","scale_up"];
function labScheduleTool(){
  return labTool("schedule_observations","เริ่มใบงานติดตามผลวัดจริงเมื่อผู้ใช้ต้องการเริ่มงาน ระบุเป้าหมาย เงื่อนไข ตัวชี้วัด หน่วย และรอบชั่วโมงจากถ้อยคำผู้ใช้ คัดวลี goal,condition,metric,unit ตามที่เขียนและใช้ข้อมูลที่ผู้ใช้ตอบก่อนหน้าได้ ถ้าขาดข้อมูลให้ถามสั้น ๆ ถ้ามีเกณฑ์เกิน/ต่ำกว่าให้บันทึก direction/limit ตามจริง มิฉะนั้น rule=null คัด exception จากคำสั่งผู้ใช้หรือส่ง null เมื่อไม่ได้กำหนด",
    {brief:chatString,goal:chatString,condition:chatString,metric:chatString,unit:chatString,duration:{type:"number"},
     rounds:{type:"array",items:{type:"number"}},exception:{type:["string","null"]},
     rule:{anyOf:[{type:"null"},{type:"object",properties:{direction:{type:"string",enum:["above","below"]},limit:{type:"number"}},
       required:["direction","limit"],additionalProperties:false}]}});
}
function numericWorkText(text){
  return String(text).normalize("NFKC").replace(/[๐-๙]/g,c=>String("๐๑๒๓๔๕๖๗๘๙".indexOf(c)));
}
function statedHours(text){
  // A suffix applies to a whole timepoint list (e.g. 1, 24 และ 48 ชั่วโมง).
  const results=[],every=[];
  const quantities=/(\d+(?:\.\d+)?(?:(?:\s*(?:,|\/|และ|กับ|and)\s*|\s+)\d+(?:\.\d+)?)*)\s*(ชั่วโมง|ช\.?\s*ม\.?|hours?\b|hrs?\b|h\b|วัน|days?\b|นาที|minutes?\b|mins?\b)/gi;
  for(const match of text.matchAll(quantities)){
    const factor=/วัน|day/i.test(match[2])?24:/นาที|min/i.test(match[2])?1/60:1;
    const numbers=match[1].match(/\d+(?:\.\d+)?/g).map(x=>Number(x)*factor);
    results.push(...numbers);
    if(numbers.length===1 && /(?:ทุก(?:ๆ|\s*ๆ)?|every)\s*$/i.test(text.slice(0,match.index)))every.push(numbers[0]);
  }
  return {points:results,every};
}
function validateScheduleIntent(args,b){
  const parts=[...(Array.isArray(b.history)?b.history:[]).filter(m=>m?.role==="user").slice(-4).map(m=>m.text),b.question];
  const text=numericWorkText(parts.join("\n"));
  const clean=s=>numericWorkText(s).toLowerCase().replace(/\s+/g,"");
  for(const [field,question] of [["goal","ต้องการติดตามเพื่อดูอะไร"],["condition","จะเก็บตัวอย่างภายใต้เงื่อนไขใด"],
    ["metric","ต้องการวัดตัวชี้วัดอะไร"],["unit","ใช้หน่วยหรือสเกลอะไรสำหรับตัวชี้วัดนี้"]]){
    requireValue(typeof args[field]==="string" && args[field].trim() && clean(text).includes(clean(args[field])),422,question);
  }
  const {points,every}=statedHours(text);
  const duration=args.duration,rounds=args.rounds;
  requireValue(Number.isFinite(duration) && duration>0 && points.includes(duration) && Array.isArray(rounds) && rounds.length<=64,
    422,"ต้องการติดตามทั้งหมดกี่ชั่วโมง และเก็บผลที่ชั่วโมงใดบ้าง");
  const close=(a,b)=>Math.abs(a-b)<1e-8;
  const interval=every.filter(h=>h>0 && h<=duration);
  requireValue(rounds.every(h=>Number.isFinite(h) && h>=0 && h<=duration && (h===0 || points.some(n=>close(h,n)) ||
    interval.some(n=>close(h/n,Math.round(h/n))))),422,"กรุณายืนยันรอบเก็บผลเป็นชั่วโมง");
  // Latest explicit schedule wins over earlier alternatives discussed in the same thread.
  const latest=[...parts].reverse().map(s=>statedHours(numericWorkText(s))).find(s=>s.points.length);
  if(latest?.points.includes(duration)){
    const agreed=[0,...rounds,duration];
    const contains=h=>agreed.some(v=>close(v,h));
    requireValue(latest.points.every(h=>h<=duration && contains(h)),422,"กรุณายืนยันระยะเวลาสิ้นสุดและรอบเก็บผลทั้งหมด");
    for(const h of latest.every.filter(h=>h>0 && h<=duration)){
      requireValue(Math.ceil(duration/h)<=64,422,"จำนวนรอบติดตามเกิน 64 รอบ");
      for(let i=1;i*h<duration;i++)requireValue(contains(i*h),422,"รอบเก็บผลยังไม่ครบตามช่วงเวลาที่ระบุ");
    }
  }
  // Match a threshold with its comparison operator, never an unrelated concentration or hour.
  const limitPattern=/(?:สูงกว่า|มากกว่า|เกิน|above|greater than|ต่ำกว่า|น้อยกว่า|below|less than|>|<)\s*([-+]?(?:\d+(?:\.\d+)?|\.\d+))/gi;
  const thresholdContext=/พัก|เตือน|หยุด|เกณฑ์|แจ้ง|ปัญหา|ถ้า|หาก|alert|pause|threshold|flag|if\b/i;
  const thresholdTurn=[...parts].reverse().map(numericWorkText).find(s=>thresholdContext.test(s) &&
    /เกิน|สูงกว่า|มากกว่า|ต่ำกว่า|น้อยกว่า|above|below|greater than|less than|[><≥≤]/i.test(s))||"";
  const triggerText=thresholdTurn.split(/[;!?\n]/u).filter(s=>thresholdContext.test(s));
  if(triggerText.some(s=>/≥|≤|>=|<=|(?:สูงกว่า|มากกว่า|ต่ำกว่า|น้อยกว่า)(?:หรือ|\s)*เท่ากับ/i.test(s)))
    throw new ApiError(422,"เกณฑ์ในใบงานรองรับสูงกว่าหรือต่ำกว่า ต้องการเลือกเงื่อนไขใดและค่าเท่าไร");
  const thresholds=triggerText.flatMap(s=>
    [...s.matchAll(limitPattern)].map(m=>({direction:/ต่ำกว่า|น้อยกว่า|below|less than|</i.test(m[0])?"below":"above",limit:Number(m[1])})));
  if(thresholds.length>1)requireValue(thresholds.every(r=>r.limit===thresholds[0].limit && r.direction===thresholds[0].direction),
    422,"กรุณาเลือกเกณฑ์พักงานหนึ่งเกณฑ์สำหรับใบงานนี้");
  if(args.rule)requireValue(thresholds.some(r=>r.direction===args.rule.direction && r.limit===args.rule.limit),422,"ต้องการพักงานเมื่อสูงกว่าหรือต่ำกว่าค่าใด");
  if(!args.rule && thresholds.length){
    const last=thresholds.at(-1);
    requireValue(false,422,"โปรดยืนยันให้ตั้งเกณฑ์พักงานเมื่อ"+(last.direction==="above"?"สูงกว่า ":"ต่ำกว่า ")+last.limit+" "+args.unit);
  }
  if(!args.exception || !clean(text).includes(clean(args.exception)))args.exception="พักใบงานเมื่อมีการแจ้งปัญหาและรอผู้ใช้ตัดสินใจ";
}
function labWorkTools() {
  const optionalNumber={type:["number","null"]}, optionalText={type:["string","null"]};
  return [
    labTool("create_study_record","เปิดใบงานตามประเภทที่ผู้ใช้สั่ง ตั้งโจทย์ตามคำขอ สร้างขั้นติดตามเอกสารและหลักฐานเท่านั้น สำหรับสังเคราะห์ถามจำนวนขั้นถ้าไม่ทราบ สำหรับความคงตัวรายเดือนถามวันเริ่มและรอบเดือน (รวมเดือน 0) งานรายชั่วโมงใช้ schedule_observations งานออกแบบสูตรทั่วไปใช้ create_brief",
      {brief:chatString,discipline:{type:"string",enum:workDisciplines},reaction_steps:{type:["integer","null"]},parallel:{type:"boolean"},
       start_date:optionalText,months:{type:"array",items:{type:"integer"}}}),
    labTool("record_study_stage","บันทึกผลหรือพักขั้นงานเมื่อผู้ใช้ขอบันทึกข้อมูลจริงจากเอกสารหรือการสังเกต เลือก study_id, sequence และ stage จากใบงานโครงการ ห้ามแต่งวันที่ ผล ค่าวัดหรือหน่วย evidence ต้องคัดข้อความระบุแหล่งข้อมูลจากผู้ใช้ ถ้าไม่ทราบให้ถาม",
      {study_id:chatString,sequence:{type:"integer"},stage:chatString,disposition:{type:"string",enum:["record","hold"]},
       observed_on:chatString,evidence:chatString,finding:chatString,unit:optionalText,measurements:{type:"array",items:{type:"number"}}}),
    labTool("update_timed_study","บันทึกค่าที่ผู้ใช้วัดจริงในใบงานติดตาม หรือพักเมื่อมีปัญหา หรือทำต่อ/หยุด/เพิ่มรอบเมื่อผู้ใช้สั่งหลังพัก เลือก id และ version ของใบงาน timed ที่เกี่ยวข้อง ผู้ใช้ต้องให้ค่า หน่วย แหล่งข้อมูล และเวลาสังเกตจริง คัด source จากข้อความผู้ใช้ observed_at ใช้ ISO พร้อมเวลาเขต หรือ now เมื่อผู้ใช้ระบุว่าเพิ่งวัด ห้ามแต่งข้อมูล",
      {study_id:chatString,version:{type:"integer"},action:{type:"string",enum:["observe","issue","continue","stop","followup"]},
       value:optionalNumber,unit:optionalText,observed_at:optionalText,source:optionalText,note:chatString,hours:optionalNumber}),
  ];
}
function validWorkDate(value){
  if(typeof value!=="string" || !/^\d{4}-\d\d-\d\d$/.test(value))return false;
  const t=Date.parse(value+"T00:00:00Z");
  return Number.isFinite(t) && new Date(t).toISOString().slice(0,10)===value;
}
const workToday=()=>new Date(Date.now()+7*3600000).toISOString().slice(0,10);
function workIntake(id,brief,body){
  const discipline=body.discipline, reaction_steps=body.reaction_steps??10, parallel=body.parallel??false;
  const months=body.months??[0,3,6,12,24,36], start_date=body.start_date??null;
  requireValue(workDisciplines.includes(discipline),422,"เลือกประเภทใบงาน");
  requireValue(Number.isInteger(reaction_steps) && reaction_steps>=2 && reaction_steps<=30,422,"ระบุจำนวนขั้นระหว่าง 2 และ 30");
  requireValue(typeof parallel==="boolean" && (!parallel || (discipline==="synthesis" && reaction_steps>=3)),422,"ตรวจจำนวนขั้นของแผนคู่ขนาน");
  requireValue(Array.isArray(months) && months.length>=2 && months.length<=36 && months.every(m=>Number.isInteger(m) && m>=0 && m<=120),422,"ระบุรอบติดตามเป็นเดือน");
  requireValue(start_date===null || (validWorkDate(start_date) && start_date>="1900-01-01" && start_date<="2200-01-01"),422,"วันเริ่มไม่ถูกต้อง");
  if(discipline==="stability")requireValue(start_date && months[0]===0 && months.every((m,i)=>!i || m>months[i-1]),422,"ระบุวันเริ่ม และเรียงเดือนติดตามจาก 0 โดยไม่ซ้ำ");
  return {id,brief,discipline,reaction_steps,parallel,start_date,months};
}
function workStages(intake){
  const {discipline,reaction_steps,parallel,months,start_date}=intake;
  const plan=REF.plans[discipline];
  if(discipline==="synthesis") return Array.from({length:reaction_steps},(_,i)=>{
    const step=i+1, parents=parallel ? step===reaction_steps ? [step-2,step-1] : step>2 ? [step-2] : [] : i ? [i] : [];
    return {...plan[0],id:"S"+step,title:"บันทึกผลปฏิกิริยาขั้นที่ "+step,depends_on:parents.map(n=>"S"+n)};
  });
  if(discipline==="stability"){
    const [year,month,day]=start_date.split("-").map(Number);
    return months.map(m=>{
      const last=new Date(Date.UTC(year,month+m,0));
      last.setUTCDate(Math.min(day,last.getUTCDate()));
      return {...plan[0],id:"M"+m,title:"ผลติดตามเดือนที่ "+m,due:last.toISOString().slice(0,10)};
    });
  }
  return plan;
}
function labRecordContext(raw){
  const row=raw.request?.kind==="study" && !raw.stages ? view(raw):raw;
  return {id:row.id,title:row.request.brief,state:row.state,sequence:row.events.length,kind:row.request.kind,
    discipline:row.request.discipline,assignee:row.request.assignee,draft:row.request.draft?.slice(0,800),
    stages:row.stages?.map(({id,title,status,minimum_values,due})=>({id,title,status,minimum_values,due}))};
}
async function labTimedContext(db,owner){
  const result=await db.prepare("SELECT payload FROM timed_studies WHERE owner=? ORDER BY created DESC LIMIT 10").bind(owner).all();
  return result.results.map(r=>{
    const row=JSON.parse(r.payload), next=timedNext(row);
    return {id:row.id,title:row.brief,state:row.state,version:row.version,metric:row.metric,unit:row.unit,
      next_due:next?new Date(next.due).toISOString():null,problem:row.problem,count:timedReport(row).count};
  });
}
function validateWorkCall(name,args,b){
  if(name==="create_study_record"){
    requireValue(workDisciplines.includes(args.discipline),422,"ระบุประเภทของใบงาน");
    if(args.discipline==="synthesis")requireValue(Number.isInteger(args.reaction_steps),422,"ต้องการติดตามเอกสารกี่ขั้น");
    if(args.discipline==="stability")requireValue(args.start_date && args.months?.length>=2,422,"ต้องการเริ่มวันไหน และเก็บข้อมูลเดือนใดบ้าง");
    return;
  }
  if(name!=="record_study_stage" && name!=="update_timed_study")return;
  // Only accept a project record that the authenticated server supplied to the model.
  const timed=name==="update_timed_study";
  const record=(timed?b.timed:b.records)?.find(r=>r.id===args.study_id);
  requireValue(record,422,"โปรดระบุใบงานที่ต้องการบันทึกอีกครั้ง");
  requireValue(timed?record.version===args.version:record.sequence===args.sequence && record.stages?.some(s=>s.id===args.stage),
    409,"สถานะหรือขั้นของใบงานเปลี่ยนแล้ว กรุณาส่งคำขออีกครั้ง");
  const text=[...(b.history||[]).filter(m=>m?.role==="user").slice(-3).map(m=>String(m.text)),b.question].join("\n").normalize("NFKC");
  if(timed && args.action!=="observe"){
    if(args.action==="stop")requireValue(/ยุติ|เลิกติดตาม|หยุดติดตาม|ปิดงาน|stop|terminate/i.test(b.question),422,"ต้องการยุติการติดตามใบงานนี้หรือไม่");
    return;
  }
  const source=timed?args.source:args.evidence;
  requireValue(typeof source==="string" && source.trim() && text.includes(source.trim().normalize("NFKC")),422,"ขอชื่อบันทึกหรือแหล่งข้อมูลของผลที่วัดจริง");
  const values=timed?[args.value]:args.measurements;
  const supplied=(text.replace(/[๐-๙]/g,c=>String("๐๑๒๓๔๕๖๗๘๙".indexOf(c))).match(/[-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[-+]?\d+)?/gi)||[]).map(Number);
  requireValue(Array.isArray(values) && values.every(n=>Number.isFinite(n) && supplied.includes(n)),422,"กรุณาระบุค่าที่วัดจริงพร้อมหน่วย");
  if(timed){
    requireValue(typeof args.unit==="string" && args.unit.trim().toLowerCase()===record.unit.trim().toLowerCase(),422,"กรุณายืนยันหน่วยตามใบงาน ("+record.unit+")");
    requireValue(args.observed_at==="now" || (typeof args.observed_at==="string" && /(?:Z|[+-]\d\d:\d\d)$/i.test(args.observed_at) && Number.isFinite(Date.parse(args.observed_at))),422,"กรุณาระบุเวลาที่วัดจริงพร้อมเขตเวลา");
    if(args.observed_at==="now")requireValue(/ตอนนี้|เพิ่ง|เมื่อกี้|เมื่อสักครู่|ขณะนี้|เวลานี้|just now|\bnow\b/i.test(text),422,"วัดค่าเมื่อใด กรุณาระบุเวลาที่วัดจริง");
  }
}
function resultCommand(stage,b){
  requireValue(/^[A-Za-z0-9_-]{1,40}$/.test(stage),422,"รหัสขั้นไม่ถูกต้อง");
  requireValue(Number.isSafeInteger(b.expected_sequence) && b.expected_sequence>=1,422,"ส่งลำดับใบงานปัจจุบัน");
  requireValue(["record","hold"].includes(b.disposition),422,"เลือกบันทึกผลหรือพักขั้นงาน");
  requireValue(validWorkDate(b.observed_on),422,"ระบุวันที่สังเกต");
  const measurements=b.measurements||[],literature=b.literature||[];
  requireValue(Array.isArray(measurements)&&measurements.length<=1000&&measurements.every(v=>Number.isFinite(v)&&Math.abs(v)<=1e50),422,"ตรวจค่าที่วัด");
  const unit=b.unit==null?null:label(b.unit,120);
  requireValue(Boolean(unit)===Boolean(measurements.length),422,"ระบุหน่วยพร้อมค่าที่วัด");
  requireValue(Array.isArray(literature) && literature.length<=5,422,"แนบแหล่งอ้างอิงได้สูงสุด 5 รายการ");
  const refs=literature.map(r=>{
    const url=label(r?.url,1000);
    requireValue(URL.canParse(url)&&["http:","https:"].includes(new URL(url).protocol),422,"ลิงก์แหล่งอ้างอิงไม่ถูกต้อง");
    return {title:label(r.title,120),url,locator:label(r.locator,120),application:label(r.application)};
  });
  return {stage,id:uuid(b.id),expected_sequence:b.expected_sequence,disposition:b.disposition,observed_on:b.observed_on,
    evidence:label(b.evidence),finding:label(b.finding),measurements,unit,literature:refs};
}
async function saveLabStage(db,project,id,stage,user,body){
  const row=await rowFor(db,project,id);
  requireValue(row.request.kind==="study" && !row.request.case_template,409,"ขั้นนี้ใช้กับใบงานวิจัยทั่วไป");
  const command=resultCommand(stage,body);
  if(replayed(row,command))return view(row);
  const previous=row.events.length,step=view(row).stages.find(s=>s.id===stage);
  requireValue(previous===command.expected_sequence,409,"ข้อมูลเปลี่ยนแล้ว กรุณาโหลดใบงานล่าสุด");
  requireValue(step && step.status==="ready",409,"ขั้นนี้ยังไม่เปิดรับข้อมูลหรือปิดแล้ว");
  const {id:commandId,stage:stageId,expected_sequence,...result}=command;
  requireValue(result.observed_on<=workToday() && (!step.due||result.observed_on>=step.due),422,"วันที่สังเกตต้องถึงรอบและไม่เกินวันนี้");
  const values=result.measurements,n=values.length;
  requireValue(result.disposition!=="record"||n>=step.minimum_values,422,"จำนวนค่าที่วัดไม่ครบตามขั้นงาน");
  const mean=n?values.reduce((s,v)=>s+v,0)/n:0;
  const sd=n>1?Math.sqrt(values.reduce((s,v)=>s+(v-mean)**2,0)/(n-1)):null;
  record(row,step.role,"head",result.finding,{actor:user,stage_id:stage,command,result,source:step.source,application:step.application,statistics:n?{n,mean,sd,unit:result.unit}:null});
  if(view(row).stages.every(s=>s.status==="complete"))row.state="awaiting_approval";
  const changed=await db.prepare("UPDATE orders SET revision = ?, payload = ? WHERE project = ? AND id = ? AND revision = ?")
    .bind(row.events.length,JSON.stringify(row),project,id,previous).run();
  if(changed.meta.changes===1)return view(row);
  const latest=await rowFor(db,project,id);
  requireValue(replayed(latest,command),409,"ใบงานเปลี่ยนแล้ว กรุณาเปิดใบงานล่าสุด");
  return view(latest);
}
