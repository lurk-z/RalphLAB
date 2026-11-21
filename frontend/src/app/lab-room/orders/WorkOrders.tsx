"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/kit/page-header";
import Link from "next/link";
import { signIn, useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { api, http, apiErrorMessage } from "@/lib/api";
import { selectLabProject } from "@/lib/select-lab-project";
import NewOrder from "./NewOrder";
import OrderDetail from "./OrderDetail";
import StartBrief from "./StartBrief";
import StudyDetail from "./StudyDetail";
import { hasVersions, isStudy, states, type Project, type Case } from "./types";

function Readers({ project }: { project: number }) {
  const path = `/api/lab/projects/${project}/readers`;
  const [list, setList] = useState<string[]>([]);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const ctrl = new AbortController();
    http<string[]>(path, { signal: ctrl.signal })
      .then(setList)
      .catch((e) => {
        if (!ctrl.signal.aborted)
          setError(apiErrorMessage(e, "โหลดสิทธิ์ไม่ได้"));
      });
    return () => ctrl.abort();
  }, [path]);
  async function change(address: string, method: "PUT" | "DELETE") {
    setBusy(true);
    setError("");
    try {
      await http(path, {
        method,
        body: JSON.stringify({ email: address.trim() }),
      });
      setList(await http<string[]>(path));
      setEmail("");
    } catch (e) {
      setError(apiErrorMessage(e, "บันทึกสิทธิ์ไม่ได้"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="wo-card">
      <summary>สิทธิ์อ่านใบงานของโครงการนี้</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void change(email, "PUT");
        }}
      >
        <label>
          อีเมล Google ของสมาชิก
          <Input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <Button variant="outline" disabled={busy}>เพิ่มผู้อ่าน</Button>
      </form>
      {list.map((a) => (
        <p key={a}>
          {a}{" "}
          <Button variant="outline" disabled={busy} onClick={() => change(a, "DELETE")}>
            ถอนสิทธิ์
          </Button>
        </p>
      ))}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}

function Inbox({ project, initialOrder }: { project: Project; initialOrder:string }) {
  const [orders, setOrders] = useState<Case[]>([]);
  const [selected, setSelected] = useState(initialOrder);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [composing, setComposing] = useState(false);
  useEffect(() => {
    const ctrl = new AbortController();
    setError("");
    http<Case[]>(`/api/lab/projects/${project.id}/orders`, {
      signal: ctrl.signal,
    })
      .then((rows) => {
        if (!ctrl.signal.aborted) {
          setOrders(rows);
          setSelected((old) =>
            rows.some((r) => r.id === old) ? old : (rows[0]?.id ?? ""),
          );
        }
      })
      .catch((e) => {
        if (!ctrl.signal.aborted)
          setError(apiErrorMessage(e, "โหลดใบงานไม่ได้"));
      });
    return () => ctrl.abort();
  }, [project.id, reload]);
  function saved(o: Case) {
    setOrders((os) => [o, ...os.filter((x) => x.id !== o.id)]);
    setSelected(o.id);
    setComposing(false);
    setReload((v) => v + 1);
  }
  const active = orders.find((o) => o.id === selected);
  return (
    <>
      {project.owner && <StartBrief project={project.id} onSave={saved} />}
      <div className="wo-actions">
        {project.owner && (
          <Button
            variant="default"
            onClick={() => setComposing(!composing)}
          >
            {composing ? "ปิดฟอร์ม" : "สร้างใบงาน"}
          </Button>
        )}
        <Button variant="outline" onClick={() => setReload((v) => v + 1)}>โหลดสถานะล่าสุด</Button>
      </div>
      {error && <p role="alert">{error}</p>}
      {composing && <NewOrder project={project.id} onSave={saved} />}
      {orders.length > 0 ? (
        <label>
          ใบงานในโครงการ
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            {orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.request.brief} · {states[o.state]}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p>โครงการนี้ยังไม่มีใบงาน</p>
      )}
      {active && isStudy(active) && <StudyDetail key={active.id} study={active} owner={project.owner} onSave={saved} />}
      {active && !isStudy(active) && !hasVersions(active) && <div className="my-4">
        <strong>{states[active.state]}</strong><p>{active.events.at(-1)?.message}</p>
        {project.owner && <NewOrder key={active.id} project={project.id} intake={active} onSave={saved}/>}
      </div>}
      {active && hasVersions(active) && (
        <OrderDetail
          key={active.id}
          order={active}
          owner={project.owner}
          onSave={saved}
        />
      )}
      {project.owner && <Readers project={project.id} />}
    </>
  );
}

export default function WorkOrders({
  signedIn,
  localDemo,
  initialProject=0,
  initialOrder="",
}: {
  signedIn: boolean;
  localDemo: boolean;
  initialProject?:number;
  initialOrder?:string;
}) {
  const session = useSession();
  const [projects, setProjects] = useState<Project[]>([]);
  const [id, setId] = useState(0);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!signedIn) return;
    const ctrl = new AbortController();
    http<Project[]>("/api/lab/projects", { signal: ctrl.signal })
      .then((rows) => {
        setProjects(rows);
        setId(rows.some(p=>p.id===initialProject) ? initialProject : rows[0]?.id ?? 0);
      })
      .catch((e) => {
        if (!ctrl.signal.aborted)
          setError(apiErrorMessage(e, "โหลดโครงการไม่ได้"));
      });
    return () => ctrl.abort();
  }, [signedIn, initialProject]);
  const current = projects.find((p) => p.id === id);
  async function openProject(project: Project | undefined) {
    if (!project) { setId(0); return; }
    setBusy(true);
    try {
      if (project.owner) await selectLabProject(project.id);
      window.location.assign("/lab-room/orders?project=" + project.id);
    } catch {
      setError("เปิดโปรเจกต์ไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally { setBusy(false); }
  }
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const p = await api.createProject(name.trim());
      setProjects((ps) => [{ id: p.id, name: p.name, owner: true }, ...ps]);
      await openProject({id:p.id, name:p.name, owner:true});
      setName("");
    } catch (e) {
      setError(apiErrorMessage(e, "สร้างโครงการไม่ได้"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="wo">
      <nav className="flex flex-wrap gap-5"><Link href="/lab-room">← ห้องแล็บ 3D</Link><Link href="/lab-room/protein">โต๊ะโปรตีน 3D</Link><a href="https://ralphlab-workbench.surawit2003it.chatgpt.site/lab-room/timed">งานติดตามตามเวลา · Cloud</a></nav>
      <PageHeader title="ใบงาน Agent" className="my-5" />
      {signedIn ? (
        <>
          <Card className="my-4 p-5">
            <label>
              โครงการ
              <select
                value={id}
                disabled={busy}
                onChange={(e) => void openProject(projects.find(p => p.id === Number(e.target.value)))}
              >
                <option value={0}>เลือกโครงการ</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {!p.owner ? " · อ่านอย่างเดียว" : ""}
                  </option>
                ))}
              </select>
            </label>
            <form className="wo-actions" onSubmit={create}>
              <label>
                โครงการใหม่
                <Input
                  value={name}
                  maxLength={200}
                  required
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <Button variant="outline" disabled={busy || !name.trim()}>สร้างโครงการ</Button>
            </form>
          </Card>
          {current && <Inbox key={current.id} project={current} initialOrder={id===initialProject ? initialOrder : ""} />}
        </>
      ) : (
        <Card className="my-4 p-5">
          <p>
            {localDemo
              ? "เริ่มเซสชันทดสอบแยกสำหรับเบราว์เซอร์นี้ เมื่อออกจากระบบ เซสชันใหม่จะมีโครงการของตัวเอง"
              : "เข้าสู่ระบบเพื่อเปิดโครงการและประวัติใบงาน"}
          </p>
          <Button
            variant="default"
            disabled={session.status === "loading"}
            onClick={() =>
              signIn(localDemo ? "lab-demo" : "google", {
                callbackUrl: "/lab-room/orders",
              })
            }
          >
            {localDemo ? "เริ่มเซสชันทดสอบ" : "เข้าสู่ระบบด้วย Google"}
          </Button>
        </Card>
      )}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
