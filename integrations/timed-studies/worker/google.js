// Google authorization-code flow. The browser gets an opaque session, never a provider token.
const sidCookie="__Host-ralphlab-session", flowCookie="__Host-ralphlab-oauth";
const sessionTTL=7*24*60*60;
const enc=new TextEncoder();
const b64bytes=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"");
const randomToken=()=>b64bytes(crypto.getRandomValues(new Uint8Array(32)));
const cookieValue=(req,name)=>(req.headers.get("cookie")||"").split(";").map(x=>x.trim()).find(x=>x.startsWith(name+"="))?.slice(name.length+1)||"";
const baked=(name,value,age)=>name+"="+value+"; Path=/; Max-Age="+age+"; Secure; HttpOnly; SameSite=Lax";
function portalRedirect(dest,cookies=[]) {
  const h=new Headers({location:dest,"cache-control":"private, no-store","referrer-policy":"no-referrer"});
  for(const c of cookies)h.append("set-cookie",c);
  return new Response(null,{status:303,headers:h});
}
async function signingKey(secret) {return crypto.subtle.importKey("raw",enc.encode("RalphLAB google state v1/"+secret),{name:"HMAC",hash:"SHA-256"},false,["sign"])}
async function flowSignature(raw,secret) {return b64bytes(await crypto.subtle.sign("HMAC",await signingKey(secret),enc.encode(raw)))}
async function beginGoogle(env,url) {
  requireValue(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET,503,"ผู้ดูแลต้องตั้งค่า Google OAuth ก่อน");
  const state=randomToken(), verifier=randomToken(), issued=Date.now();
  const raw=[state,verifier,issued].join(".");
  const google=new URL("https://accounts.google.com/o/oauth2/v2/auth");
  google.search=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:url.origin+"/api/auth/callback/google",
    response_type:"code",scope:"openid email profile",state,prompt:"select_account",code_challenge_method:"S256",
    code_challenge:b64bytes(await crypto.subtle.digest("SHA-256",enc.encode(verifier)))}).toString();
  return portalRedirect(google.href,[baked(flowCookie,raw+"."+await flowSignature(raw,env.GOOGLE_CLIENT_SECRET),600)]);
}
async function getPortalSession(request,env) {
  const sid=cookieValue(request,sidCookie);
  if(!/^[\w-]{43}$/.test(sid))return null;
  const key="google/sessions/"+await timedDigest(sid),obj=await env.BUCKET.get(key);
  if(!obj)return null;
  const data=await obj.json();
  if(data.exp<=Date.now()) {await env.BUCKET.delete(key);return null;}
  return {key,etag:obj.etag,data};
}
async function finishGoogle(request,env,url) {
  const clear=baked(flowCookie,"",0);
  // Log only fixed reason codes. Provider messages and callback parameters can contain credentials.
  const fail=(reason,clearFlow=true)=>{
    console.warn("Google sign-in:",reason);
    return portalRedirect("/login?error="+reason,clearFlow?[clear]:[]);
  };
  if(!env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_CLIENT_ID) return fail("configuration");
  const [state,verifier,issued,sig]=cookieValue(request,flowCookie).split(".");
  if(!state || !verifier) return fail("flow_cookie",false);
  if(state!==url.searchParams.get("state")) return fail("flow_state",false);
  if(!/^\d+$/.test(issued||"") || Date.now()<Number(issued) || Date.now()-Number(issued)>600000) return fail("flow_expired");
  if(sig!==await flowSignature([state,verifier,issued].join("."),env.GOOGLE_CLIENT_SECRET)) return fail("flow_signature");
  if(url.searchParams.get("error")==="access_denied") return fail("access_denied");
  if(!url.searchParams.get("code")) return fail("missing_code");
  let stage="token_network";
  try {
    const token=await fetch("https://oauth2.googleapis.com/token",{method:"POST",redirect:"manual",signal:AbortSignal.timeout(15000),
      headers:{"content-type":"application/x-www-form-urlencoded"},
      body:new URLSearchParams({grant_type:"authorization_code",code:url.searchParams.get("code"),code_verifier:verifier,
        client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,redirect_uri:url.origin+"/api/auth/callback/google"}).toString()});
    if(!token.ok) {
      const err=(await token.json().catch(()=>({}))).error;
      return fail(["invalid_client","invalid_grant","redirect_uri_mismatch"].includes(err)?err:"token_response");
    }
    const access=(await token.json()).access_token;
    if(typeof access!=="string" || !access)return fail("token_response");
    // UserInfo is called directly at Google's endpoint with the access token obtained for this client.
    stage="profile";
    const info=await fetch("https://openidconnect.googleapis.com/v1/userinfo",{redirect:"manual",signal:AbortSignal.timeout(15000),headers:{authorization:"Bearer "+access}});
    if(!info.ok)return fail(stage);
    const g=await info.json();
    if(typeof g.sub!=="string" || !/^[\w-]{1,255}$/.test(g.sub) || g.email_verified!==true || typeof g.email!=="string")return fail("profile");
    stage="session_storage";
    const subKey="google/accounts/"+await timedDigest(g.sub);
    let account=await (await env.BUCKET.get(subKey))?.json();
    if(!account) {
      const old=identity(request);
      const linked=old?.email?.toLowerCase()===g.email.toLowerCase() && old?.id;
      const next={owner:linked?old.id:"google/"+g.sub,legacyProject:null};
      if(linked && await env.DB.prepare("SELECT id FROM timed_studies WHERE owner=? LIMIT 1").bind(old.id).first()) {
        const name="ใบงานเดิมของฉัน";
        await env.DB.prepare("INSERT INTO projects(owner,name,created) VALUES (?,?,?) ON CONFLICT(owner,name) DO NOTHING").bind(old.id,name,new Date().toISOString()).run();
        next.legacyProject=(await env.DB.prepare("SELECT id FROM projects WHERE owner=? AND name=?").bind(old.id,name).first()).id;
      }
      const added=await env.BUCKET.put(subKey,JSON.stringify(next),{onlyIf:{etagDoesNotMatch:"*"}});
      account=added?next:await (await env.BUCKET.get(subKey)).json();
    }
    const sid=randomToken();
    await env.BUCKET.put("google/sessions/"+await timedDigest(sid),JSON.stringify({owner:account.owner,legacyProject:account.legacyProject,
      email:g.email,name:g.name||g.email,project:null,exp:Date.now()+sessionTTL*1000}));
    return portalRedirect("/projects",[baked(sidCookie,sid,sessionTTL),clear]);
  } catch {return fail(stage);}
}
function dropIdentity(request) {
  const h=new Headers(request.headers);
  for(const k of [...h.keys()]) if(k.startsWith("oai-authenticated-user-")) h.delete(k);
  return h;
}
async function portalGate(request,env) {
  const url=new URL(request.url),p=url.pathname.replace(/\/+$/,"")||"/",get=["GET","HEAD"].includes(request.method);
  if(get && (p==="/api/health" || /^\/(assets|models|images|icons|fonts)\//.test(p))) return {request};
  if(p==="/api/auth/google" && get)return beginGoogle(env,url);
  if(p==="/api/auth/callback/google" && get)return finishGoogle(request,env,url);
  if((p.startsWith("/api/lab/qsar") && request.headers.has("x-qsar-runner")) ||
     (p==="/api/lab/team" && request.headers.has("x-ralphlab-team-setup")) ||
     /^\/api\/timed\/[\w-]+\/relay$/.test(p))return {request:new Request(request,{headers:dropIdentity(request)})};
  const session=await getPortalSession(request,env);
  if(p==="/api/auth/logout" && request.method==="POST") {
    await bodyOf(request,url); if(session)await env.BUCKET.delete(session.key);
    return new Response("{}",{headers:{"content-type":"application/json","cache-control":"no-store","set-cookie":baked(sidCookie,"",0)}});
  }
  const d=session?.data;
  const db=env.DB.withSession?env.DB.withSession("first-primary"):env.DB;
  const project=d?.project ? await db.prepare("SELECT id,name FROM projects WHERE owner=? AND id=?").bind(d.owner,d.project).first() : null;
  if(p==="/api/auth/session" && get)return json(d?{user:{id:d.owner,email:d.email,name:d.name},project}: {});
  if(p==="/api/portal/projects") {
    requireValue(d,401,"กรุณาเข้าสู่ระบบด้วย Google");
    if(get)return json((await db.prepare("SELECT id,name,created FROM projects WHERE owner=? ORDER BY id DESC").bind(d.owner).all()).results);
    requireValue(request.method==="POST",405,"ใช้ POST");
    const b=await bodyOf(request,url); let selected;
    if(b.action==="create") {
      const name=label(b.name,120);
      await db.prepare("INSERT INTO projects(owner,name,created) VALUES (?,?,?) ON CONFLICT(owner,name) DO NOTHING").bind(d.owner,name,new Date().toISOString()).run();
      selected=await db.prepare("SELECT id,name FROM projects WHERE owner=? AND name=?").bind(d.owner,name).first();
    } else {
      requireValue(b.action==="select" && Number.isSafeInteger(b.id) && b.id>0,422,"เลือกโปรเจกต์");
      selected=await db.prepare("SELECT id,name FROM projects WHERE owner=? AND id=?").bind(d.owner,b.id).first();
    }
    requireValue(selected,404,"ไม่พบโปรเจกต์ในบัญชีนี้");
    const updated=await env.BUCKET.put(session.key,JSON.stringify({...d,project:selected.id}),{onlyIf:{etagMatches:session.etag}});
    requireValue(updated,409,"เซสชันเปลี่ยนแล้ว กรุณาเปิดหน้าโปรเจกต์อีกครั้ง"); return json(selected);
  }
  const page=!p.startsWith("/api/");
  if(page && get) {
    if(p==="/login" && d)return portalRedirect("/projects");
    if(!d && p!=="/login")return portalRedirect("/login");
    if(d && !project && p!=="/projects")return portalRedirect("/projects");
    if(p==="/" && d)return portalRedirect("/projects");
    if(["/login","/projects"].includes(p)) {
      const asset=new URL("/index.html",url);
      const entry=await env.ASSETS.fetch(new Request(asset,{method:request.method}));
      if (![301,302,307,308].includes(entry.status)) return entry;
      return env.ASSETS.fetch(new Request(new URL("/",url),{method:request.method}));
    }
    const requested=url.searchParams.get("project");
    if(requested && Number(requested)!==project?.id)return portalRedirect("/projects");
  }
  requireValue(d,401,"กรุณาเข้าสู่ระบบด้วย Google");
  requireValue(project,409,"สร้างหรือเลือกโปรเจกต์ก่อนเข้าห้องแล็ป");
  if(get && ["/api/projects","/api/lab/projects"].includes(p))return json([{...project,owner:true}]);
  if(p==="/api/projects" && !get)throw new ApiError(409,"สร้างโปรเจกต์ผ่านหน้าโปรเจกต์");
  const requested=p.match(/^\/api\/(?:lab\/projects|research\/project)\/(\d+)(?:\/|$)/);
  if(requested)requireValue(Number(requested[1])===project.id,404,"ไม่พบงานในโปรเจกต์ที่เลือก");
  const scoped=/^\/api\/(timed(?:\/|$)|lab\/(team|qsar)(?:\/|$)|research\/timed\/)/.test(p);
  const owner=scoped && project.id!==d.legacyProject ? "portal/"+await timedDigest(d.owner)+"/"+project.id:d.owner;
  const h=dropIdentity(request);h.set("oai-authenticated-user-id",owner);
  return {request:new Request(request,{headers:h})};
}
