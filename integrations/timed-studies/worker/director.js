// Only the browser's typed dispatcher can turn these plans into project operations.
const labRoles = {director:"หัวหน้าแล็บ",researcher:"นักวิจัย",formulator:"นักพัฒนาสูตร",analyst:"นักวิเคราะห์",evaluator:"ผู้ประเมิน"};
const chatString = {type:"string"};
function labTool(name,description,properties) {
  return {type:"function",name,description,strict:true,parameters:{
    type:"object",properties,required:Object.keys(properties),additionalProperties:false,
  }};
}
const directorTools = [
  labTool("show_tool","เปิดหรือดูรายการเครื่องมือที่ผู้ใช้ขอ โดยไม่สร้างงาน",
    {target:{type:"string",enum:["protein","orders","timed","self_test"]}}),
  labTool("create_brief","บันทึกใบงานจริงเมื่อผู้ใช้ขอให้สร้างงานหรือออกแบบผลิตภัณฑ์ รวมถึงคำขอสร้างเจลล้างมือ ให้จัดทำฉบับร่างเฉพาะโจทย์ขณะเรียกเครื่องมือ",
    {title:chatString,draft:chatString,assignee:{type:"string",enum:["researcher","formulator","analyst","evaluator"]}}),
  labTool("protein_study","เปิดใบงานบนโต๊ะ 3D สำหรับดูหรือจัดแนวโครงสร้างอ้างอิงที่เลือก หรือเปรียบเทียบอินซูลินกับ lispro",
    {model:{type:"string",enum:["gfp","insulin","insulin_lispro"]},brief:chatString}),
  labTool("schedule_observations","เริ่มใบงานติดตามผลวัดจริงเป็นชั่วโมง เฉพาะเมื่อทราบตัวอย่าง ตัวชี้วัด หน่วย และรอบเวลาจากผู้ใช้ ห้ามประดิษฐ์ค่าที่วัดหรือเงื่อนไขการเก็บ",
    {brief:chatString,goal:chatString,condition:chatString,metric:chatString,unit:chatString,duration:{type:"number"},rounds:{type:"array",items:{type:"number"}},exception:chatString}),
];
const formulaDraftTool=labTool("draft_cosmetic_formula","เสนอสูตรเครื่องสำอางเบื้องต้นเมื่อผู้ใช้ขอสัดส่วน ใช้ชื่อส่วนผสมพร้อมเปอร์เซ็นต์รวม 100 และระบุสิ่งที่ต้องตรวจสอบ",
  {name:chatString,notes:chatString,items:{type:"array",items:{type:"object",properties:{name:chatString,concentration:{type:"number"}},
    required:["name","concentration"],additionalProperties:false}}});
async function planLabChat(env,b) {
  requireValue(Object.hasOwn(labRoles,b.role),422,"ไม่พบบทบาท");
  const question=label(b.question,4000);
  const history=Array.isArray(b.history)?b.history.slice(-12).map(m=>({
    role:m?.role==="assistant"?"assistant":"user",content:label(m?.text,2000)
  })):[];
  const key=String(env.OPENAI_API_KEY||"").trim().replace(/^OPENAI_API_KEY\s*=\s*/i,"").replace(/^Bearer\s+/i,"").replace(/^(["'])(.*)\1$/,"$2").trim();
  requireValue(key,503,"แชท OpenAI ยังไม่ได้ตั้งค่าบนเซิร์ฟเวอร์");
  const context=typeof b.context==="string"?b.context.slice(0,4000):"";
  let response;
  try {
    response=await fetch("https://api.openai.com/v1/responses",{method:"POST",redirect:"manual",
      signal:AbortSignal.timeout(30000),headers:{authorization:"Bearer "+key,"content-type":"application/json"},
      body:JSON.stringify({model:env.OPENAI_CHAT_MODEL||"gpt-4.1-mini",store:false,max_output_tokens:1400,
        instructions:[
          "คุณเป็น"+labRoles[b.role]+"ในโปรเจกต์จริงของ RalphLAB ตอบภาษาไทยตามโจทย์และประวัติสนทนา",
          "ใช้เฉพาะข้อมูลที่ให้มาและความรู้ที่แยกจากผลวัดจริง ห้ามแต่งสถานะงาน ผลการทดลอง หรือแหล่งอ้างอิง เมื่อขาดข้อมูลสำคัญให้ถามสั้น ๆ",
          "หัวหน้าใช้เครื่องมือเมื่อผู้ใช้สั่งงาน การถามข้อมูลหรือบอกไม่ให้ทำ ให้ตอบโดยไม่สร้างงาน ถ้ามีใบงานนั้นแล้วใช้ผลเดิม ผู้ใช้ตอบว่าทำเลยหมายถึงงานที่สนทนาค้างอยู่",
          "การเปิดใบงานเป็นงานเอกสารเท่านั้น ห้ามอ้างว่าได้ทำการทดลองจริงหรือควบคุมเครื่องมือ ผู้เชี่ยวชาญให้คำปรึกษาได้และแนะนำให้หัวหน้าสั่งงาน",
          "งานออกแบบผลิตภัณฑ์ผู้บริโภคให้ร่างตามวัตถุประสงค์ ระบุส่วนประกอบและบทบาท ข้อสมมติ และสิ่งที่ต้องทดสอบ ห้ามอ้างสรรพคุณทางการแพทย์หรือความปลอดภัยที่ยังไม่ได้วัด",
          "สำหรับงานอันตรายให้จำกัดคำตอบเฉพาะข้อมูลความปลอดภัยทั่วไป ห้ามเสนอวิธีสร้างสารพิษ อาวุธ หรือดัดแปลงและเผยแพร่เชื้อก่อโรค",
        ].join("\n"),input:[...history,{role:"user",content:JSON.stringify({question,project_context:context,recent_project_orders:b.records})}],
        ...(b.role==="director"||b.role==="formulator"?{tools:b.role==="director"?directorTools:[formulaDraftTool],parallel_tool_calls:false}:{}),
      })});
  } catch {throw new ApiError(502,"ติดต่อ OpenAI ไม่สำเร็จ กรุณาลองอีกครั้ง");}
  requireValue(response.ok,response.status===429?429:502,"OpenAI ยังตอบคำขอนี้ไม่ได้ (HTTP "+response.status+")");
  const result=await response.json();
  requireValue(result.status==="completed",502,"OpenAI ตอบไม่ครบ กรุณาลองอีกครั้ง");
  const call=result.output?.find(item=>item.type==="function_call");
  if(call) {
    if(b.role==="formulator" && call.name===formulaDraftTool.name){
      let a;
      try {a=JSON.parse(call.arguments);}catch {throw new ApiError(502,"อ่านข้อเสนอสูตรไม่ได้");}
      requireValue(a && Array.isArray(a.items) && a.items.length>0 && a.items.length<=20 &&
        a.items.every(i=>typeof i.name==="string" && i.name.trim() && Number.isFinite(i.concentration) && i.concentration>0 && i.concentration<=100) &&
        Math.abs(a.items.reduce((sum,i)=>sum+i.concentration,0)-100)<0.0001,502,"สัดส่วนของสูตรที่ OpenAI ส่งมายังไม่ครบ กรุณาลองอีกครั้ง");
      return {answer:[label(a.name,240),...a.items.map(i=>i.name+" "+i.concentration+"%"),label(a.notes,3500)].join("\n"),
        proposals:[{name:a.name,items:a.items}]};
    }
    requireValue(b.role==="director" && directorTools.some(t=>t.name===call.name),502,"OpenAI ส่งคำสั่งที่ไม่รองรับ");
    let args;
    try {args=JSON.parse(call.arguments);} catch {throw new ApiError(502,"OpenAI ส่งข้อมูลคำสั่งไม่ครบ");}
    return {tool:call.name,args};
  }
  const answer=(result.output||[]).flatMap(m=>m.content||[]).map(c=>c.text||c.refusal||"").filter(Boolean).join("\n").trim();
  requireValue(answer,502,"OpenAI ยังไม่ส่งคำตอบ");
  return {answer};
}
async function directorRelay(request,env,url) {
  requireValue(request.method==="POST",405,"ใช้ POST");
  const supplied=request.headers.get("x-ralphlab-chat-relay");
  requireValue(supplied && env.RALPHLAB_CHAT_RELAY_TOKEN &&
    await timedDigest(supplied)===await timedDigest(env.RALPHLAB_CHAT_RELAY_TOKEN),401,"ไม่มีสิทธิ์ใช้แชท");
  const b=await bodyOf(request,url,96000);
  return json(await cachedLabPlan(env,b,"native/"+label(b.scope,150)));

}

// Store the winning plan before any tool runs so that a retry replays identical arguments.
async function cachedLabPlan(env,b,scope) {
  const key="chat-plans/"+await timedDigest(scope)+"/"+uuid(b.id);
  const signature=await timedDigest(JSON.stringify([b.role,b.question]));
  const readSaved=async object=>{
    const saved=await object.json();
    requireValue(saved.signature===signature,409,"รหัสข้อความนี้ถูกใช้แล้ว");
    return saved.plan;
  };
  const old=await env.BUCKET.get(key);
  if(old)return readSaved(old);
  const plan=await planLabChat(env,b);
  const written=await env.BUCKET.put(key,JSON.stringify({signature,plan}),{onlyIf:{etagDoesNotMatch:"*"}});
  return written?plan:readSaved(await env.BUCKET.get(key));
}
