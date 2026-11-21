import {createHash} from "node:crypto";
import {NextRequest} from "next/server";
import {currentSession,projectAccess,projectCookie} from "@/lib/active-project";
import {extractOrderEvidence} from "./order-evidence";
import type {Case} from "@/app/lab-room/orders/types";

const cloud = "https://ralphlab-workbench.surawit2003it.chatgpt.site";
const hash = (text:string) => createHash("sha256").update(text).digest("hex");
const fail = (detail:string,status:number) => Response.json({detail},{status});
export async function relayLabRequest(request:NextRequest, target:"chat"|"timed", parts:string[] = []) {
  if (request.method==="POST" && request.headers.get("origin")!==request.nextUrl.origin)
    return fail("คำขอมาจากเว็บไซต์อื่น",403);
  const session=await currentSession();
  const viewer=session?.user?.id || session?.user?.email;
  if (!viewer) return fail("กรุณาเข้าสู่ระบบด้วย Google",401);
  const project=Number(request.cookies.get(projectCookie)?.value);
  const requested=request.headers.get("x-ralphlab-project");
  if (!Number.isSafeInteger(project)||project<1||(requested && Number(requested)!==project))
    return fail("เลือกโปรเจกต์อีกครั้ง",409);
  const access=await projectAccess(project).catch(()=>503);
  if(access!==200)return fail("เปิดโปรเจกต์ไม่ได้",access);
  const token=process.env.RALPHLAB_CHAT_RELAY_TOKEN;
  if(!token)return fail("ยังไม่ได้เชื่อมบริการแชตของ RalphLAB Cloud",503);
  const scope=hash(JSON.stringify([viewer,project]));
  let path="/api/relay/chat-plan", body:Record<string,unknown>|undefined;
  const headers:Record<string,string>={"content-type":"application/json"};
  if(request.method==="POST"){
    if(!request.headers.get("content-type")?.startsWith("application/json"))return fail("ต้องส่ง JSON",415);
    if(Number(request.headers.get("content-length"))>96000)return fail("ข้อมูลยาวเกินกำหนด",413);
    const data=await request.text();
    if(Buffer.byteLength(data)>96000)return fail("ข้อมูลยาวเกินกำหนด",413);
    try {body=JSON.parse(data);}catch{return fail("ข้อมูลไม่ถูกต้อง",422);}
    if(!body||typeof body!=="object"||Array.isArray(body))return fail("ข้อมูลไม่ถูกต้อง",422);
  }
  if(target==="chat"){
    if(!body)return fail("ต้องส่งข้อความ",422);
    const api=process.env.NEXT_PUBLIC_API_URL||"http://localhost:8000";
    const orders=await fetch(api+"/api/lab/projects/"+project+"/orders",{headers:{Authorization:"Bearer "+session?.backendToken},
      cache:"no-store",signal:AbortSignal.timeout(8000)}).catch(()=>null);
    if(!orders?.ok)return fail("อ่านใบงานของโปรเจกต์ไม่ได้",503);
    const rows:Case[]=await orders.json();
    const mentioned = new Set(String(body.question || "").toLowerCase().match(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/g) || []);
    const relevant = [...rows.filter(r=>mentioned.has(r.id)), ...rows.filter(r=>!mentioned.has(r.id))];
    body={...body,scope,project,orderEvidence:extractOrderEvidence(relevant),records:relevant.slice(0,24).map(r=>({
      id:r.id,title:r.request.brief.slice(0,240),state:r.state,sequence:r.events.length,
      kind:"kind" in r.request?r.request.kind:undefined,discipline:"discipline" in r.request?r.request.discipline:undefined,
      assignee:"assignee" in r.request?r.request.assignee:undefined,draft:"draft" in r.request?r.request.draft?.slice(0,800):undefined,
      stages:"stages" in r?r.stages.map(({id,title,status,minimum_values,due})=>({id,title,status,minimum_values,due})):undefined}))};
    // Keep the named work and current turn when the project has many long worksheets.
    const context = body as {records:unknown[];orderEvidence:unknown[];history?:unknown[]};
    const exceedsRelayLimit = () => Buffer.byteLength(JSON.stringify(body)) > 96000;
    while(context.records.length > 1 && exceedsRelayLimit()) context.records.pop();
    while(context.orderEvidence.length && exceedsRelayLimit()) context.orderEvidence.pop();
    while(Array.isArray(context.history) && context.history.length && exceedsRelayLimit()) context.history.shift();
    if(exceedsRelayLimit())return fail("ข้อความและบริบทของใบงานยาวเกินกำหนด",413);
    headers["x-ralphlab-chat-relay"]=token;
  }else{
    if(parts.length>2 || (parts.length && !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(parts[0])) ||
      (parts[1] && parts[1]!=="events"))return fail("ไม่พบงานติดตาม",404);
    path="/api/relay/native-timed"+(parts.length?"/"+parts.join("/"):"");
    headers["x-native-timed"]=hash("native-timed:"+token);
    headers["x-native-scope"]=scope;
  }
  try{
    const result=await fetch(cloud+path,{method:request.method,headers,body:body?JSON.stringify(body):undefined,
      cache:"no-store",redirect:"error",signal:AbortSignal.timeout(85000)});
    if(!result.headers.get("content-type")?.includes("application/json"))return fail("ติดต่อ RalphLAB Cloud ไม่สำเร็จ",502);
    return new Response(result.body,{status:result.status,headers:{"content-type":"application/json","cache-control":"private, no-store"}});
  } catch{return fail("ติดต่อ RalphLAB Cloud ไม่สำเร็จ",502);}
}
