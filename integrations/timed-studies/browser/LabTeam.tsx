import { useEffect, useRef, useState } from "react";
import QsarPanel from "./QsarPanel";
import "./timed.css";

type Agent = {
  role: string;
  name: string;
  task: string;
  tool: string;
  id: string | null;
};
type Team = { configured: boolean; agents: Agent[] };
type Run = { study: string; role: string; run: string };
type Result = {
  answer?: string;
  output?: unknown;
  pending?: boolean;
  version?: number;
};
async function request(path: string, body?: object) {
  const response = await fetch(path, {
    cache: "no-store",
    ...(body && {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
  const value = await response.json();
  if (!response.ok) throw Error(value.detail || "เปิดทีมไม่ได้");
  return value;
}
const api = "/api/lab/team";
export default function LabTeam() {
  const [team, setTeam] = useState<Team>(),
    [studies, setStudies] = useState<{ id: string; brief: string }[]>([]);
  const [study, selectStudy] = useState(
    new URLSearchParams(location.search).get("study") || "",
  );
  const [role, selectRole] = useState("director"),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(),
    [running, setRunning] = useState<Run>();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    Promise.all([request(api), request("/api/timed")])
      .then(([t, rows]) => {
        if (!alive.current) return;
        setTeam(t);
        setStudies(rows);
        selectStudy((s) =>
          rows.some((r: { id: string }) => r.id === s) ? s : rows[0]?.id || "",
        );
        const raw = sessionStorage.getItem("ralphlab.agent.run");
        if (raw) {
          const r = JSON.parse(raw);
          if (rows.some((item: { id: string }) => item.id === r.study)) {
            setRunning(r);
            selectRole(r.role);
            selectStudy(r.study);
          }
        }
      })
      .catch((e) => setMessage(e.message));
    return () => {
      alive.current = false;
    };
  }, []);
  async function act(action: "provision" | "preview" | "start" | "poll") {
    if (busy) return;
    setBusy(true);
    setMessage("");
    setResult(undefined);
    try {
      if (action === "provision") {
        await request(api, { action });
        setTeam(await request(api));
        return;
      }
      if (action === "preview") {
        setResult(await request(api, { action, role, study }));
        return;
      }
      const r =
        action === "poll" ? running : { role, study, run: crypto.randomUUID() };
      if (!r) return;
      setRunning(r);
      sessionStorage.setItem("ralphlab.agent.run", JSON.stringify(r));
      let output = await request(api, { ...r, action });
      for (let i = 0; output.pending && i < 30 && alive.current; i++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        if (!alive.current) return;
        output = await request(api, { ...r, action: "poll" });
      }
      if (!alive.current) return;
      setResult(output);
      if (!output.pending) {
        setRunning(undefined);
        sessionStorage.removeItem("ralphlab.agent.run");
      }
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const agent = team?.agents.find((a) => a.role === role);
  return (
    <main className="timed">
      <nav>
        <a href="/">ห้องแล็บ</a> /{" "}
        <a href="/lab-room/timed">ใบงานติดตามตามเวลา</a>
      </nav>
      <h1>ทีมนักวิจัย RalphLAB</h1>
      {message && <p role="alert">{message}</p>}
      {team && <QsarPanel key={study} study={study}/>}
      {!team && !message && <p role="status">กำลังโหลดทีม…</p>}
      {team && (
        <>
          <section>
            <h2>สถานะ OpenAI</h2>
            <p>
              Saved Agents {team.agents.filter((a) => a.id).length} จาก{" "}
              {team.agents.length} ตัว
            </p>
            {!team.configured && (
              <p>
                เพิ่ม OPENAI_API_KEY ใน Site settings → Environment variables
                เปิด Secret บันทึก แล้ว deploy Site อีกครั้ง
              </p>
            )}
            <button
              disabled={busy || !team.configured}
              onClick={() => act("provision")}
            >
              สร้างหรือเชื่อมทีมบน OpenAI
            </button>
          </section>
          <section>
            <h2>หน้าที่และเครื่องมือประจำ</h2>
            <ul>
              {team.agents.map((a) => (
                <li key={a.role}>
                  <strong>
                    {a.name} · {a.role}
                  </strong>
                  <p>{a.task}</p>
                  <small>
                    {a.tool}
                    {a.role === "researcher" && " · ค้นเว็บเมื่อเปิดใช้ OpenAI"}
                    {a.id && " · " + a.id}
                  </small>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2>มอบหมายใบงาน</h2>
            {studies.length === 0 ? (
              <a href="/lab-room/timed">สร้างใบงานติดตามตามเวลา</a>
            ) : (
              <>
                <label>
                  ใบงาน
                  <select
                    value={study}
                    disabled={busy || !!running}
                    onChange={(e) => {
                      selectStudy(e.target.value);
                      setResult(undefined);
                    }}
                  >
                    {studies.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.brief}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  ผู้รับผิดชอบ
                  <select
                    value={role}
                    disabled={busy || !!running}
                    onChange={(e) => {
                      selectRole(e.target.value);
                      setResult(undefined);
                    }}
                  >
                    {team.agents.map((a) => (
                      <option key={a.role} value={a.role}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  disabled={busy || !!running}
                  onClick={() => act("preview")}
                >
                  ดูผลเครื่องมือจากใบงาน
                </button>{" "}
                <button
                  disabled={busy || !team.configured || !agent?.id}
                  onClick={() => act(running ? "poll" : "start")}
                >
                  {running ? "ติดตาม Session เดิม" : "ส่งใบงานให้ OpenAI"}
                </button>
                {running && !busy && (
                  <button
                    onClick={() => {
                      sessionStorage.removeItem("ralphlab.agent.run");
                      setRunning(undefined);
                      setResult(undefined);
                      setMessage("");
                    }}
                  >
                    ออกจากการติดตาม
                  </button>
                )}
                {busy && <p role="status">กำลังทำงาน…</p>}
                {result?.pending && (
                  <p role="status">Session กำลังทำงาน กดติดตามเพื่อรับผล</p>
                )}
                {result?.answer && (
                  <article>
                    <h3>
                      รายงานจาก {agent?.name} · ใบงานรุ่น {result.version}
                    </h3>
                    <p style={{ whiteSpace: "pre-wrap" }}>{result.answer}</p>
                  </article>
                )}
                {result?.output != null && (
                  <details open>
                    <summary>ผลเครื่องมือ · {agent?.tool}</summary>
                    <pre
                      style={{
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {JSON.stringify(result.output, null, 2)}
                    </pre>
                  </details>
                )}
              </>
            )}
          </section>
        </>
      )}
    </main>
  );
}
