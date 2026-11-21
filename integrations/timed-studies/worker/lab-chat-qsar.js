// These cosmetic ingredients have verified structures in RalphLAB's scientific registry.
const chatCosmetics = {
  962: ["น้ำ", "น้ำเปล่า", "aqua", "water"], 753: ["กลีเซอริน","กลีเซอรีน","กลีเซอรอล","glycerin","glycerol","glycerine"],
  936: ["ไนอะซินาไมด์","ไนอาซินาไมด์","niacinamide","nicotinamide"], 4678: ["แพนทีนอล","แพนเทนอล","panthenol"],
  1176: ["ยูเรีย","urea"], 311: ["กรดซิตริก","citric acid"],
};
const chatQsarRegions = {face:["ใบหน้า","ผิวหน้า","face"],eye:["รอบตา","รอบดวงตา","ดวงตา","eye"],
  hand:["บริเวณมือ","ผิวมือ","ที่มือ","ฝ่ามือ","หลังมือ","on hand","region hand"],forearm:["ท้องแขน","ปลายแขน","forearm"]};
const labQsarTools = [
  labTool("run_chat_qsar","ส่งสูตรเครื่องสำอางให้โมเดล RalphLAB QSAR คำนวณเมื่อผู้ใช้สั่งและระบุบริเวณ สาร และสัดส่วนแล้ว หากข้อมูลไม่ครบให้ถาม เลือกเฉพาะสารที่ผู้ใช้กำหนด ห้ามเดาสูตรหรือเติมน้ำให้ครบ ตัวเลือก "+Object.entries(chatCosmetics).map(([cid,n])=>n[0]+" CID "+cid).join(", "),{
    region:{type:"string",enum:Object.keys(chatQsarRegions)},
    ingredients:{type:"array",items:{type:"object",properties:{cid:{type:"integer",enum:Object.keys(chatCosmetics).map(Number)},percent:{type:"number"}},required:["cid","percent"],additionalProperties:false}},
  }),
  labTool("read_chat_qsar","อ่านผล/สถานะ QSAR จริงจากเลขงาน UUID ที่บันทึกในแชต เมื่อต้องการผลล่าสุดของทั้งโปรเจกต์ให้ใช้ use_latest=true และ job_id ว่าง หากไม่มีรหัสและไม่ทราบว่าหมายถึงงานใดให้ถาม",{
    job_id:{type:"string"},use_latest:{type:"boolean"},
  }),
];
const qsarUuid=/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
function normalizedQsarText(value) {
  return String(value||"").normalize("NFKC").toLowerCase().replace(/[๐-๙]/g,d=>String(d.charCodeAt(0)-3664));
}
function qsarMentionedFormula(text,ingredients) {
  // Bind every requested percentage to the adjacent ingredient identifier. Matching
  // the same values somewhere else in the turn can swap two ingredients by mistake.
  const percent="\\s*(?:%|เปอร์เซ็นต์|percent\\b)";
  const amounts=text.match(new RegExp("\\d+(?:\\.\\d+)?"+percent,"gi"))||[];
  if(amounts.length!==ingredients.length)return false;
  const pairs=ingredients.map(({cid,percent:value})=>{
    const names=chatCosmetics[cid].map(normalizedQsarText).map(n=>/^[a-z]/.test(n)?"\\b"+n+"\\b":n);
    const ingredient="(?:"+names.join("|")+"|(?<!\\d)(?:cid\\s*[:#]?\\s*)?"+cid+"(?!\\d))";
    const after=new RegExp(ingredient+"\\s*(?:\\(\\s*(?:cid\\s*)?"+cid+"\\s*\\))?\\s*[:=·]?\\s*(\\d+(?:\\.\\d+)?)"+percent,"gi");
    const before=new RegExp("(?<![\\d.\\-])(\\d+(?:\\.\\d+)?)"+percent+"\\s*"+ingredient,"gi");
    return {after:[...text.matchAll(after)].some(m=>Number(m[1])===value),
      before:[...text.matchAll(before)].some(m=>Number(m[1])===value)};
  });
  return pairs.every(p=>p.after)||pairs.every(p=>p.before);
}
function validateQsarIntent(plan,b) {
  if(!plan || !["run_chat_qsar","read_chat_qsar"].includes(plan.tool))return plan;
  const previous=Array.isArray(b.history)?b.history.slice(-12):[];
  const users=[...previous.filter(m=>m?.role==="user").map(m=>normalizedQsarText(m.text)),normalizedQsarText(b.question)];
  if(plan.tool==="read_chat_qsar"){
    const args=plan.args||{};
    const id=String(args.job_id||"").toLowerCase();
    const known=[...previous.map(m=>normalizedQsarText(m?.text)),users.at(-1)].some(s=>s.includes(id));
    const latest=/ล่าสุด|most recent|latest/i.test(users.at(-1));
    if(args.use_latest===true && !id && latest)return plan;
    if(args.use_latest===false && qsarUuid.test(id) && known)return plan;
    return {answer:"ต้องการอ่านผล QSAR ใบไหนครับ? ส่งเลขงานจากใบรับงาน หรือพิมพ์ “อ่านผล QSAR ล่าสุด”"};
  }
  const {region,ingredients}=plan.args||{};
  const question=users.at(-1);
  const clarify={answer:"ขอชื่อสารหรือ PubChem CID พร้อมเปอร์เซ็นต์ของแต่ละตัว และบริเวณที่ต้องการประเมินครับ เช่น “ประเมิน QSAR ใบหน้า น้ำ 95% กลีเซอริน 5%”"};
  if(!Object.hasOwn(chatQsarRegions,region)||!Array.isArray(ingredients)||ingredients.length===0||ingredients.length>Object.keys(chatCosmetics).length ||
     !ingredients.every(i=>i&&Number.isSafeInteger(i.cid)&&Object.hasOwn(chatCosmetics,i.cid)&&Number.isFinite(i.percent)&&i.percent>0&&i.percent<=100) ||
     new Set(ingredients.map(i=>i.cid)).size!==ingredients.length || ingredients.reduce((s,i)=>s+i.percent,0)>100.0001)return clarify;
  if(ingredients.every(i=>i.cid===962))return {answer:"น้ำเป็นตัวพาสูตรในโมเดล QSAR กรุณาเพิ่มส่วนผสมที่จะประเมินพร้อมสัดส่วนครับ"};
  const selected=b.selectedFormula;
  const refersToSelected=/สูตรที่เลือก|สูตรปัจจุบัน|selected formula|current formula/.test(question);
  if(refersToSelected && selected?.region===region && Array.isArray(selected.ingredients) &&
    selected.ingredients.length===ingredients.length && ingredients.every(i=>selected.ingredients.some(r=>r?.cid===i.cid&&r.percent===i.percent)))return plan;
  const recentFormula=users.findLast(t=>/%|เปอร์เซ็นต์|\bpercent\b/.test(t));
  const regionText=users.findLast(t=>Object.values(chatQsarRegions).flat().some(n=>t.includes(n)));
  // A compound request can contain several explicitly named formulas, each of
  // which must match as a whole (without taking ingredients across recipes).
  const recipes=recentFormula?.split(/(?:สูตร|formula)\s*(?:ที่\s*)?(?:[a-z](?![a-z])|\d+|[ก-ฮ](?=\s|:))\s*[:：]?/iu) || [];
  if(!recipes.some(s=>qsarMentionedFormula(s,ingredients))||!regionText||!chatQsarRegions[region].some(n=>regionText.includes(n)))return clarify;
  return plan;
}
async function labChatQsarAPI(request,env,url,project){
  const account=identity(request)?.id;
  const scope=request.headers.get("x-lab-qsar-owner");
  requireValue(account && scope,401,"กรุณาเข้าสู่ระบบเพื่อเปิดงาน QSAR");
  const db=env.DB.withSession?env.DB.withSession("first-primary"):env.DB;
  await projectFor(db,account,Number(project));
  if(request.method==="GET"){
    const job=url.searchParams.get("job"),owner="user/"+scope;
    const row=job==="latest" ? await db.prepare("SELECT * FROM qsar_jobs WHERE owner=? ORDER BY created DESC,id DESC LIMIT 1").bind(owner).first()
      : await db.prepare("SELECT * FROM qsar_jobs WHERE owner=? AND id=?").bind(owner,uuid(job)).first();
    if(job==="latest" && !row)return json(null);
    requireValue(row,404,"ไม่พบงาน QSAR ในโปรเจกต์นี้");
    return json(qsarView(row));
  }
  requireValue(request.method==="POST",405,"ใช้ POST เพื่อประเมินสูตร");
  const b=await bodyOf(request,url);
  const formula=cleanFormula(b);
  requireValue(formula.ingredients.every(i=>Object.hasOwn(chatCosmetics,i.cid)),422,"แชตยังไม่มีสารที่ระบุในรายการเครื่องสำอางที่ตรวจสอบแล้ว");
  requireValue(formula.ingredients.some(i=>i.cid!==962),422,"เพิ่มสารที่จะประเมินในสูตรน้ำ");
  const target=new URL("/api/lab/qsar",url);
  return qsarAPI(new Request(target,{method:"POST",headers:{"content-type":"application/json","oai-authenticated-user-id":scope},
    body:JSON.stringify({id:uuid(b.id),...formula,mode:"model"})}),env,target);
}
