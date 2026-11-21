"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import { useRef, useState } from "react";
import { ChevronRight, FlaskConical, Play, RotateCcw, X } from "lucide-react";
import { api, apiErrorMessage, http } from "@/lib/api";
import type { Project, Study } from "@/app/lab-room/orders/types";
import { ROLE_LABEL } from "../agents/roles";
import type { DeskBinding, useProteinDesk } from "./useProteinDesk";
import "./desk.css";

const exampleProject = "โต๊ะโปรตีน 3D · งานตัวอย่าง";
const exampleId = "75321194-b674-43de-943c-a29f09a00853";
const openStudy = (row: Study) =>
  `/lab-room?project=${row.project_id}&order=${row.id}`;

export function DeskLauncher({
  signedIn,
  localLogin,
  callbackUrl = "/lab-room?table=protein",
}: {
  signedIn: boolean;
  localLogin: boolean;
  callbackUrl?: string;
}) {
  const router = useRouter();
  const { status } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sending = useRef(false);
  async function start() {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      const projects = await http<Project[]>("/api/lab/projects");
      let id = projects.find((p) => p.owner && p.name === exampleProject)?.id;
      if (!id) id = (await api.createProject(exampleProject)).id;
      const row = await http<Study>(`/api/lab/projects/${id}/studies`, {
        method: "POST",
        body: JSON.stringify({
          id: exampleId,
          brief:
            "จัดแนวสาย A และ B ของอินซูลินบนโต๊ะ 3D แล้วเทียบกับโครงสร้าง PDB 3I40",
          discipline: "discovery",
        }),
      });
      router.push(openStudy(row));
    } catch (e) {
      setError(apiErrorMessage(e, "เปิดงานตัวอย่างไม่ได้"));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  return (
    <aside className="desk-overlay" aria-label="เลือกงานบนโต๊ะ">
      <div className="desk-heading">
        <FlaskConical size={17} />
        <h2>วางงานบนโต๊ะโปรตีน</h2>
        <Link
          className="desk-close"
          href="/lab-room"
          aria-label="ปิดโต๊ะโปรตีน"
        >
          <X size={16} />
        </Link>
      </div>
      {signedIn ? (
        <>
          <p>
            เปิดใบงานค้นคว้ายาของทีม หรือเริ่มด้วยงานตัวอย่างจัดแนวสายอินซูลิน
          </p>
          <div className="desk-actions">
            <button
              className="desk-primary"
              disabled={busy || status !== "authenticated"}
              onClick={start}
            >
              {busy ? "กำลังเปิดใบงาน…" : "เปิดงานตัวอย่างอินซูลิน"}
            </button>
            <Link className="desk-secondary" href="/lab-room/orders">
              เลือกใบงานของทีม <ChevronRight size={14} />
            </Link>
          </div>
        </>
      ) : (
        <>
          <p>
            เข้าสู่ระบบเพื่อวางใบงานของคุณบนโต๊ะและบันทึกการเปลี่ยนท่าของโปรตีน
          </p>
          <button
            className="desk-primary"
            disabled={status === "loading"}
            onClick={() =>
              signIn(localLogin ? "lab-demo" : "google", { callbackUrl })
            }
          >
            {localLogin ? "เริ่มเซสชันทดสอบ" : "เข้าสู่ระบบด้วย Google"}
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </aside>
  );
}

const steps = ["ตรวจโครงสร้าง", "ปรับมุม", "จัดแนว", "ตรวจผล"];
const indexOf = { inspect: 0, adjust: 1, align: 2, verify: 3 };

export function ProteinDeskPanel({
  binding,
  desk,
}: {
  binding: DeskBinding;
  desk: ReturnType<typeof useProteinDesk>;
}) {
  const [startFrom, setStartFrom] = useState<"exercise" | "latest">("latest");
  const [history, setHistory] = useState("");
  const { study, phase, pose } = desk.state;
  const frame = desk.active;
  const rowLink = `/lab-room/orders?project=${binding.project}&order=${binding.order}`;
  const runs =
    study?.events
      .filter((e) => e.protein_step?.phase === "inspect")
      .slice()
      .reverse() ?? [];
  const runId =
    runs.find((e) => e.protein_step?.run_id === history)?.protein_step
      ?.run_id ?? runs[0]?.protein_step?.run_id;
  const stage = frame ? indexOf[frame.step.phase] : phase === "done" ? 3 : -1;
  const lastSaved = study?.events.findLast((e) => e.pose)?.pose;
  const isAligned = lastSaved?.rmsd === 0;
  const from = isAligned ? "exercise" : startFrom;
  return (
    <aside
      className="desk-overlay"
      aria-label="งานโปรตีนบนโต๊ะ"
      data-phase={phase ?? "idle"}
    >
      <div className="desk-heading">
        <FlaskConical size={17} />
        <h2>โต๊ะโปรตีน</h2>
        {desk.table && (
          <a
            href={desk.table.protein.source_url}
            target="_blank"
            rel="noreferrer"
          >
            PDB {desk.table.protein.pdb} ↗
          </a>
        )}
        <Link
          className="desk-close"
          href="/lab-room"
          aria-label="ออกจากโต๊ะโปรตีน"
        >
          <X size={16} />
        </Link>
      </div>
      {study && (
        <p className="desk-brief">
          <Link href={rowLink}>{study.request.brief} ↗</Link>
        </p>
      )}
      {desk.error && (
        <p role="alert">
          {desk.error} <button onClick={desk.retry}>ลองโหลดอีกครั้ง</button>
        </p>
      )}
      {!desk.table && !desk.error && (
        <p role="status">กำลังโหลดใบงานและพิกัดโปรตีน…</p>
      )}
      {desk.table && study && (
        <>
          <div className="desk-status" role="status" aria-live="polite">
            <span>
              {frame
                ? (phase === "working" ? "กำลังทำงาน" : "กำลังเดินไปที่โต๊ะ") +
                  " · " +
                  ROLE_LABEL[frame.role]
                : phase === "done"
                  ? "แสดงผลครบแล้ว"
                  : "วางโปรตีนบนโต๊ะแล้ว"}
            </span>
            {pose && (
              <span className="desk-metric">RMSD {pose.rmsd.toFixed(3)} Å</span>
            )}
          </div>
          {frame && (
            <div className="desk-progress">
              <div>{frame.message}</div>
              <ol aria-label="ขั้นตอนการจัดแนว">
                {steps.map((s, i) => (
                  <li
                    key={s}
                    data-current={stage === i}
                    data-complete={stage > i}
                  >
                    {i + 1}. {s}
                  </li>
                ))}
              </ol>
            </div>
          )}
          {frame ? (
            <button className="desk-secondary" onClick={desk.finish}>
              ไปยังท่าล่าสุด
            </button>
          ) : (
            <>
              <div className="desk-actions">
                {desk.owner && !study.report && (
                  <>
                    <button
                      className="desk-primary"
                      disabled={desk.pending}
                      onClick={() => desk.run(from)}
                    >
                      <Play size={14} />
                      {desk.pending
                        ? "กำลังบันทึกการจัดแนว…"
                        : "ให้ทีมจัดแนวโปรตีน"}
                    </button>
                    {isAligned ? (
                      <small>รอบใหม่เริ่มจากท่าแบบฝึก</small>
                    ) : (
                      lastSaved && (
                        <select
                          aria-label="ท่าเริ่มงาน"
                          value={startFrom}
                          onChange={(e) =>
                            setStartFrom(e.target.value as typeof startFrom)
                          }
                        >
                          <option value="latest">ใช้ท่าล่าสุด</option>
                          <option value="exercise">ใช้ท่าแบบฝึก</option>
                        </select>
                      )
                    )}
                  </>
                )}
                {runId && (
                  <button
                    className="desk-secondary"
                    disabled={desk.pending}
                    onClick={() => desk.replay(runId)}
                  >
                    <RotateCcw size={14} /> ดูการทำงานซ้ำ
                  </button>
                )}
                {runs.length > 1 && (
                  <select
                    aria-label="เลือกรอบดูย้อนหลัง"
                    value={runId}
                    onChange={(e) => setHistory(e.target.value)}
                  >
                    {runs.map((e, i) => (
                      <option key={e.id} value={e.protein_step!.run_id}>
                        รอบ {runs.length - i} ·{" "}
                        {new Date(e.at).toLocaleTimeString("th-TH")}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {!desk.owner && <small>คุณมีสิทธิ์ดูการทำงานของทีม</small>}
            </>
          )}
        </>
      )}
    </aside>
  );
}
