import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FolderOpen, Plus } from "lucide-react";

type Project = {id: number; name: string};
const signInErrors: Record<string,string> = {
  flow_cookie: "RalphLAB ไม่ได้รับคุกกี้เริ่มเข้าสู่ระบบ เปิดลิงก์ RalphLAB ในแท็บเบราว์เซอร์โดยตรงแล้วกดเข้าสู่ระบบอีกครั้ง",
  flow_state: "คำขอนี้ไม่ตรงกับรอบที่เริ่มไว้ กรุณาเข้าสู่ระบบอีกครั้งจากแท็บนี้",
  flow_expired: "คำขอเข้าสู่ระบบหมดอายุ กรุณาเริ่มอีกครั้ง",
  flow_signature: "ค่าการเข้าสู่ระบบเปลี่ยนไป กรุณาเริ่มอีกครั้ง",
  access_denied: "Google ยังไม่ได้อนุญาตให้เข้าถึงบัญชี คุณสามารถเลือกบัญชีแล้วลองอีกครั้ง",
  missing_code: "Google ไม่ได้ส่งรหัสยืนยันกลับมา กรุณาเริ่มเข้าสู่ระบบอีกครั้ง",
  invalid_grant: "รหัสอนุญาตของ Google หมดอายุหรือใช้ไปแล้ว กรุณาเริ่มเข้าสู่ระบบอีกครั้ง",
  invalid_client: "Google ไม่ยอมรับข้อมูล OAuth ของแอป ผู้ดูแลต้องตรวจ Client ID และ Client Secret",
  configuration: "ผู้ดูแลต้องตั้งค่า Google OAuth ของ RalphLAB",
  redirect_uri_mismatch: "ผู้ดูแลต้องตรวจที่อยู่ callback ใน Google Cloud",
  token_network: "RalphLAB เชื่อมต่อ Google เพื่อแลกรหัสไม่ได้ กรุณาลองอีกครั้ง",
  token_response: "Google ปฏิเสธการแลกรหัสอนุญาต กรุณาเริ่มอีกครั้ง",
  profile: "RalphLAB อ่านบัญชีที่ยืนยันอีเมลจาก Google ไม่สำเร็จ",
  session_storage: "RalphLAB บันทึกเซสชันไม่ได้ กรุณาลองอีกครั้ง",
};
async function portalRequest(path: string, body?: object) {
  const res = await fetch(path, body ? {
    method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body),
  } : {cache: "no-store"});
  if (res.status === 401) { location.assign("/login"); throw new Error("กรุณาเข้าสู่ระบบอีกครั้ง"); }
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "เชื่อมต่อ RalphLAB ไม่สำเร็จ");
  return data;
}
export default function ProjectPortal({login}: {login: boolean}) {
  const [rows, setRows] = useState<Project[]>([]);
  const [loading, setLoading] = useState(!login);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const errorCode = new URLSearchParams(location.search).get("error");
  useEffect(() => {
    if (login) return;
    let alive = true;
    portalRequest("/api/portal/projects").then(r => { if (alive) setRows(r); })
      .catch(e => { if (alive) setError(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [login]);
  async function enter(body: object) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const project = await portalRequest("/api/portal/projects", body);
      location.assign("/lab-room?project=" + project.id);
    } catch (e) { setError(e instanceof Error ? e.message : "เปิดโปรเจกต์ไม่สำเร็จ"); setBusy(false); }
  }
  function create(event: FormEvent) {
    event.preventDefault();
    if (name.trim()) void enter({action: "create", name: name.trim()});
  }
  if (login) return <main className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top,hsl(174_70%_93%),white_55%)] px-4">
    <section className="w-full max-w-sm rounded-3xl border bg-white p-8 text-center shadow-xl">
      <img src="/icons/logo-new.png" alt="" width="64" height="64" className="mx-auto mb-4"/>
      <h1 className="text-2xl font-bold">เข้าสู่ระบบ RalphLAB</h1>
      <p className="my-4 text-sm text-muted-foreground">สร้างหรือเลือกโปรเจกต์เพื่อเข้าห้องแล็ปของคุณ</p>
      {errorCode && <p role="alert" className="my-3 text-sm text-red-700">{Object.hasOwn(signInErrors,errorCode) ? signInErrors[errorCode] : "กรุณาเริ่มเข้าสู่ระบบด้วย Google อีกครั้ง"}</p>}
      <Button asChild variant="outline" className="w-full"><a href="/api/auth/google" target="_top">เข้าสู่ระบบด้วย Google</a></Button>
    </section>
  </main>;
  return <div className="min-h-screen bg-muted/30">
    <header className="border-b bg-white"><div className="mx-auto flex max-w-4xl items-center justify-between p-4">
      <div className="flex items-center gap-2 font-bold"><img src="/icons/logo-new.png" alt="" width="32" height="32"/>RalphLAB</div>
      <Button variant="ghost" onClick={async () => {try {await portalRequest("/api/auth/logout", {}); location.assign("/login");} catch {setError("ออกจากระบบไม่สำเร็จ");}}}>ออกจากระบบ</Button>
    </div></header>
    <main className="mx-auto grid max-w-4xl gap-6 px-4 py-8">
      <h1 className="text-3xl font-bold">โปรเจกต์ของคุณ</h1>
      <form onSubmit={create} className="grid gap-3 rounded-xl border bg-white p-5">
        <label htmlFor="project-name" className="font-semibold">สร้างโปรเจกต์ใหม่</label>
        <div className="flex flex-wrap items-center gap-3"><Input id="project-name" required maxLength={120} placeholder="ชื่อโปรเจกต์" value={name} onChange={e => setName(e.target.value)}/>
        <Button disabled={busy || !name.trim()} type="submit"><Plus size={16}/>สร้างแล้วเข้าห้องแล็ป</Button></div>
      </form>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <section aria-label="โปรเจกต์ที่มีอยู่" className="grid gap-2">
        {loading && <p role="status">กำลังโหลดโปรเจกต์…</p>}
        {rows.map(p => <button type="button" disabled={busy} onClick={() => enter({action:"select", id:p.id})} key={p.id}
          className="flex items-center gap-3 rounded-xl border bg-white p-4 text-left hover:border-teal-500"><FolderOpen size={19}/>{p.name}</button>)}
      </section>
    </main>
  </div>;
}
