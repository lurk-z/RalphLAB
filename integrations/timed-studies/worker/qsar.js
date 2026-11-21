// D1 owns the queue. Only the paired scientific runner can claim work or record predictions.
const qsarTool = { type: "function", name: "run_formula_qsar",
  description: "Run RalphLAB's trained QSAR models on the exact cosmetic formula selected by the user.",
  parameters: {type: "object", properties: {}, required: [], additionalProperties: false}, strict: true };
const qsarInstructions = "คุณคือนักวิเคราะห์ QSAR ของ RalphLAB ต้องใช้เครื่องมือกับสูตรที่ผู้ใช้เลือกก่อนรายงานผล สรุปผลคัดกรองเป็นภาษาไทยสั้น ๆ ใช้เฉพาะผลจากเครื่องมือ ระบุความเชื่อมั่นและข้อจำกัด แยกผลทำนายจากผลวัดจริง";
const qsarMessage = "ประเมินสูตรสกินแคร์ที่ยืนยันไว้ในใบงานด้วยเครื่องมือของ RalphLAB";
async function latestQsarForStudy(db,user,study) {
  const latest=await db.prepare("SELECT id,result FROM qsar_jobs WHERE owner=? AND study=? AND state='complete' ORDER BY created DESC LIMIT 1").bind("user/"+user,study).first();
  return latest ? {job_id:latest.id, ...JSON.parse(latest.result)} : null;
}
async function qsarResponse(env, input, planning, model) {
  if (!env.OPENAI_API_KEY) throw Error("ยังไม่ได้ตั้ง OPENAI_API_KEY");
  const key = env.OPENAI_API_KEY.trim().replace(/^OPENAI_API_KEY\s*=\s*/i,"").replace(/^Bearer\s+/i,"").replace(/^(["'])(.*)\1$/,"$2").trim();
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST", headers: {authorization: "Bearer " + key, "content-type": "application/json"},
    signal: AbortSignal.timeout(30000), body: JSON.stringify({
      model: model || env.QSAR_REPORT_MODEL || "gpt-4.1-mini", store: false, instructions: qsarInstructions,
      input, tools: [qsarTool], parallel_tool_calls: false,
      tool_choice: planning ? {type:"function", name:qsarTool.name} : "none", max_output_tokens: 700,
    }),
  });
  if (!res.ok) {
    const error = (await res.json().catch(() => ({}))).error;
    throw Error("OpenAI HTTP " + res.status + (typeof error?.code === "string" && /^[a-z_]{1,64}$/.test(error.code) ? " (" + error.code + ")" : ""));
  }
  return res.json();
}
function cleanFormula(b) {
  requireValue(["forearm","hand","face","eye"].includes(b.region),422,"เลือกบริเวณประเมิน");
  requireValue(Array.isArray(b.ingredients) && b.ingredients.length >= 1 && b.ingredients.length <= 20,422,"ระบุส่วนผสม 1–20 รายการ");
  const seen = new Set();
  const ingredients = b.ingredients.map(({cid, percent}) => {
    requireValue(Number.isSafeInteger(cid) && cid > 0 && cid <= 2147483647 && !seen.has(cid),422,"ระบุ PubChem CID ที่ไม่ซ้ำ");
    requireValue(typeof percent === "number" && Number.isFinite(percent) && percent > 0 && percent <= 100,422,"ระบุสัดส่วน 0–100%");
    seen.add(cid);
    return {cid,percent};
  });
  requireValue(ingredients.reduce((s,i)=>s+i.percent,0)<=100.0001,422,"สัดส่วนรวมเกิน 100%");
  return {region:b.region,ingredients};
}
function qsarView(r) {
  const stalled = r.state==="preparing" && Date.now()-r.created>120000;
  const reportExpired = r.state==="complete" && r.call && !r.report && Date.now()>r.until+60000;
  return {id:r.id,study:r.study,state:stalled?"failed":r.state,created:r.created,mode:r.mode,formula:JSON.parse(r.formula),
    result:r.result ? JSON.parse(r.result) : null, report:r.report, issue:r.issue || (stalled?"การเรียกเครื่องมือหมดเวลา กรุณาส่งงานใหม่":reportExpired?"เครื่องคำนวณส่งผลแล้ว แต่ยังไม่ได้รายงานจาก OpenAI":null), tool_called:Boolean(r.call)};
}
async function qsarAPI(request,env,url) {
  const supplied = request.headers.get("x-qsar-runner");
  const runner = Boolean(supplied && env.QSAR_RUNNER_TOKEN && await timedDigest(supplied) === await timedDigest(env.QSAR_RUNNER_TOKEN));
  const user = identity(request)?.id;
  requireValue(runner || user,401,"ลงชื่อเข้าใช้ด้วย ChatGPT");
  const owner = runner ? "runtime" : "user/" + user;
  const db = env.DB.withSession ? env.DB.withSession("first-primary") : env.DB;
  const path = url.pathname.replace(/\/+$/,"").split("/").slice(4);
  const post = request.method === "POST";
  const now = Date.now();
  if (path[0] === "runner") {
    requireValue(runner && post && path.length===2,403,"ต้องใช้สิทธิ์เครื่องรัน");
    const b=await bodyOf(request,url);
    if(path[1]==="claim") {
      const lease=crypto.randomUUID();
      const row=await db.prepare("UPDATE qsar_jobs SET state='running',lease=?,until=? WHERE id=(SELECT id FROM qsar_jobs WHERE state='queued' OR (state='running' AND until<?) ORDER BY created LIMIT 1) RETURNING id,formula").bind(lease,now+120000,now).first();
      return json(row?{id:row.id,lease,formula:JSON.parse(row.formula)}:null);
    }
    requireValue(path[1]==="finish",404,"ไม่พบคำสั่ง");
    const id=uuid(b.id), lease=uuid(b.lease);
    const row=await db.prepare("SELECT * FROM qsar_jobs WHERE id=? AND lease=?").bind(id,lease).first();
    requireValue(row,409,"สิทธิ์รับงานหมดอายุ");
    if(row.state!=="running") return json({state:row.state});
    if(b.error) {
      await db.prepare("UPDATE qsar_jobs SET state='failed',issue=? WHERE id=? AND lease=? AND state='running'").bind(String(b.error).slice(0,240),id,lease).run();
      return json({state:"failed"});
    }
    const result=b.result;
    requireValue(result?.engine==="RalphLAB QSAR" && result.endpoints && ["skin","eye","sens","acute"].every(k=>Number.isFinite(result.endpoints[k]?.peak_score)),422,"ผลโมเดลไม่ครบ");
    const write=await db.prepare("UPDATE qsar_jobs SET state='complete', result=?,until=? WHERE id=? AND lease=? AND state='running'").bind(JSON.stringify(result),now,id,lease).run();
    if(write.meta.changes && row.call) {
      const {call,model}=JSON.parse(row.call);
      try {
        const response=await qsarResponse(env,[{role:"user",content:qsarMessage},call,{type:"function_call_output",call_id:call.call_id,output:JSON.stringify(result)}],false,model);
        const report=response.output?.flatMap(i=>i.type==="message"?i.content||[]:[]).filter(i=>i.type==="output_text").map(i=>i.text).join("\n");
        if(!report) throw Error("OpenAI ยังไม่ส่งรายงาน");
        await db.prepare("UPDATE qsar_jobs SET report=? WHERE id=?").bind(report,id).run();
      } catch(e) {
        await db.prepare("UPDATE qsar_jobs SET issue=? WHERE id=?").bind(String(e.message).slice(0,200),id).run();
      }
    }
    return json({state:"complete"});
  }
  if(path.length===1 && request.method==="GET") {
    const row=await db.prepare("SELECT * FROM qsar_jobs WHERE id=? AND owner=?").bind(uuid(path[0]),owner).first();
    requireValue(row,404,"ไม่พบงาน QSAR ของบัญชีนี้"); return json(qsarView(row));
  }
  requireValue(path.length===0,404,"ไม่พบเส้นทาง QSAR");
  const studyArg=url.searchParams.get("study");
  if(!post) {
    requireValue(request.method==="GET",405,"ใช้ GET หรือ POST");
    const rows=await db.prepare("SELECT * FROM qsar_jobs WHERE owner=? AND study IS ? ORDER BY created DESC LIMIT 10").bind(owner,studyArg?uuid(studyArg):null).all();
    return json(rows.results.map(qsarView));
  }
  const b=await bodyOf(request,url), id=uuid(b.id), study=b.study?uuid(b.study):null;
  requireValue(["agent","model"].includes(b.mode),422,"เลือกวิธีประเมิน");
  if(study) requireValue(user && !runner && await db.prepare("SELECT id FROM timed_studies WHERE id=? AND owner=?").bind(study,user).first(),404,"ไม่พบใบงานของบัญชีนี้");
  const formula=JSON.stringify(cleanFormula(b));
  const previous=await db.prepare("SELECT * FROM qsar_jobs WHERE id=?").bind(id).first();
  if(previous) {
    requireValue(previous.owner===owner && previous.study===study && previous.formula===formula && previous.mode===b.mode,409,"หมายเลขงานถูกใช้แล้ว");
    return json(qsarView(previous));
  }
  const state=b.mode==="agent"?"preparing":"queued";
  const inserted=await db.prepare("INSERT OR IGNORE INTO qsar_jobs(id,owner,study,created,state,formula,mode) SELECT ?,?,?,?,?,?,? WHERE (SELECT count(*) FROM qsar_jobs WHERE owner=? AND created>?)<12 AND (SELECT count(*) FROM qsar_jobs WHERE created>? AND state IN ('preparing','queued','running'))<100").bind(id,owner,study,now,state,formula,b.mode,owner,now-3600000,now-3600000).run();
  requireValue(inserted.meta.changes,429,"คิวมีงานอยู่ กรุณารอสักครู่");
  if(b.mode==="agent") {
    try {
      const response=await qsarResponse(env,[{role:"user",content:qsarMessage}],true);
      const item=response.output?.find(i=>i.type==="function_call" && i.name===qsarTool.name);
      if(!item?.call_id || Object.keys(JSON.parse(item.arguments)).length) throw Error("OpenAI ไม่ได้เรียกเครื่องมือ QSAR");
      const call={type:"function_call",call_id:item.call_id,name:item.name,arguments:item.arguments};
      await db.prepare("UPDATE qsar_jobs SET state='queued',call=? WHERE id=? AND state='preparing'").bind(JSON.stringify({call,model:response.model}),id).run();
    } catch(e) {
      await db.prepare("UPDATE qsar_jobs SET state='queued',issue=? WHERE id=? AND state='preparing'").bind("OpenAI ไม่ได้เรียกเครื่องมือ · "+String(e.message).slice(0,150)+" · คำนวณด้วย QSAR โดยตรง",id).run();
    }
  }
  return json(qsarView(await db.prepare("SELECT * FROM qsar_jobs WHERE id=? AND owner=?").bind(id,owner).first()),202);
}
