"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ROLE_LABEL } from "@/components/three/skincare-lab/agents/roles";
import { http, apiErrorMessage } from "@/lib/api";
import ProteinWorkbench from "../protein/ProteinWorkbench";
import {
  disciplines,
  states,
  type Study,
  type Step,
  type StudyEvent,
} from "./types";

const roles: Record<string, string> = { ...ROLE_LABEL, head: "เจ้าของโครงการ" };
const localDate = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Bangkok" }).format(
    new Date(),
  );

function ResultForm({
  step,
  post,
  busy,
}: {
  step: Step;
  busy: boolean;
  post: (path: string, data: object) => Promise<boolean>;
}) {
  const [reference, setReference] = useState(false);
  const [hold, setHold] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fields = new FormData(form);
    const get = (name: string) => String(fields.get(name) || "").trim();
    const raw = get("measurements");
    const values = raw ? raw.split(/[\s,]+/).map(Number) : [];
    if (
      values.some((v) => !Number.isFinite(v)) ||
      (!hold && values.length < step.minimum_values) ||
      !!values.length !== !!get("unit")
    ) {
      setError("ตรวจจำนวนค่าที่วัดและใส่หน่วยของชุดข้อมูล");
      return;
    }
    setError("");
    const literature = reference
      ? [
          {
            title: get("title"),
            url: get("url"),
            locator: get("locator"),
            application: get("application"),
          },
        ]
      : [];
    const ok = await post(`stages/${step.id}/results`, {
      disposition: hold ? "hold" : "record",
      observed_on: get("observed_on"),
      evidence: get("evidence"),
      finding: get("finding"),
      measurements: values,
      unit: get("unit") || null,
      literature,
    });
    if (ok) {
      form.reset();
      setReference(false);
      setHold(false);
    }
  }
  return (
    <form className="my-3 border-t pt-3" onSubmit={submit}>
      <div className="wo-pair">
        <label>
          การส่งต่อ
          <select
            value={hold ? "hold" : "record"}
            onChange={(e) => setHold(e.target.value === "hold")}
          >
            <option value="record">รับข้อมูลและส่งต่อ</option>
            <option value="hold">พักขั้นนี้เพื่อขอข้อมูลเพิ่ม</option>
          </select>
        </label>
        <label>
          วันที่สังเกตหรือทบทวน
          <Input
            type="date"
            name="observed_on"
            min={step.due || undefined}
            max={localDate()}
            defaultValue={localDate()}
            required
          />
        </label>
      </div>
      <label>
        หลักฐานจากงานนี้ เช่น รหัสสมุดแล็บหรือไฟล์ต้นทาง
        <Input name="evidence" required maxLength={1500} />
      </label>
      <label>
        ข้อค้นพบและเหตุผลที่ส่งต่อหรือพักงาน
        <textarea name="finding" required maxLength={1500} />
      </label>
      <div className="wo-pair">
        <label>
          ค่าที่วัดในชุดเดียวกัน
          {step.minimum_values > 0
            ? ` · อย่างน้อย ${step.minimum_values} ค่า`
            : " (ถ้ามี)"}
          <Input
            name="measurements"
            required={!hold && step.minimum_values > 0}
            placeholder="คั่นค่าด้วยจุลภาค"
          />
        </label>
        <label>
          หน่วยของค่าที่วัด
          <Input name="unit" maxLength={120} />
        </label>
      </div>
      <label className="protein-check">
        <input
          type="checkbox"
          checked={reference}
          onChange={(e) => setReference(e.target.checked)}
        />{" "}
        เพิ่มงานวิจัยหรือเอกสารที่ทีมใช้ตัดสินใจ
      </label>
      {reference && (
        <fieldset className="rounded-lg border p-3">
          <legend>แหล่งอ้างอิงเพิ่มเติม</legend>
          <label>
            ชื่อเอกสาร
            <Input name="title" required maxLength={120} />
          </label>
          <label>
            ลิงก์ต้นฉบับหรือ DOI URL
            <Input type="url" name="url" required />
          </label>
          <label>
            หน้า หัวข้อ หรือรูปที่ใช้
            <Input name="locator" required maxLength={120} />
          </label>
          <label>
            นำมาใช้กับข้อค้นพบนี้อย่างไร
            <textarea name="application" required maxLength={1500} />
          </label>
        </fieldset>
      )}
      {error && <p role="alert">{error}</p>}
      <Button type="submit" disabled={busy}>
        บันทึกผลขั้นนี้
      </Button>
    </form>
  );
}

function RecordDetail({ event }: { event: StudyEvent }) {
  const result = event.result;
  if (!result) return null;
  return (
    <div className="my-3 border-l-2 border-teal-600 pl-3">
      <strong>
        {result.disposition === "hold"
          ? "พักเพื่อขอข้อมูลเพิ่ม"
          : "รับข้อมูลขั้นนี้แล้ว"}
      </strong>
      <p>{result.finding}</p>
      <div>หลักฐานจากงาน · {result.evidence}</div>
      <div>
        วันที่สังเกต {result.observed_on} · ผู้บันทึก {event.actor}
      </div>
      {event.statistics && (
        <p>
          ค่าที่ส่ง {result.measurements.join(", ")} {result.unit}
          <br />
          ค่าเฉลี่ย{" "}
          {event.statistics.mean.toLocaleString("th-TH", {
            maximumSignificantDigits: 6,
          })}{" "}
          {result.unit}
          {event.statistics.sd !== null &&
            " · SD " +
              event.statistics.sd.toLocaleString("th-TH", {
                maximumSignificantDigits: 6,
              }) +
              " " +
              result.unit}{" "}
          · n = {event.statistics.n}
        </p>
      )}
      {result.literature.map((r, i) => (
        <p key={i}>
          เอกสารที่ทีมระบุ ·{" "}
          <a href={r.url} target="_blank" rel="noreferrer">
            {r.title}
          </a>{" "}
          · {r.locator}
          <br />
          {r.application}
        </p>
      ))}
    </div>
  );
}

export default function StudyDetail({
  study,
  owner,
  onSave,
}: {
  study: Study;
  owner: boolean;
  onSave: (s: Study) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [note, setNote] = useState("");
  const [bench, setBench] = useState(false);
  const last = useRef({ key: "", id: "" });
  async function post(path: string, data: object) {
    if (busy) return false;
    setBusy(true);
    setError("");
    const body = { ...data, expected_sequence: study.events.length };
    const key = path + JSON.stringify(body);
    if (last.current.key !== key)
      last.current = { key, id: crypto.randomUUID() };
    try {
      onSave(
        await http<Study>(
          `/api/lab/projects/${study.project_id}/orders/${study.id}/${path}`,
          {
            method: "POST",
            body: JSON.stringify({ ...body, id: last.current.id }),
          },
          path === "advice" ? 120000 : undefined,
        ),
      );
      return true;
    } catch (e) {
      setError(apiErrorMessage(e, "บันทึกไม่ได้"));
      return false;
    } finally {
      setBusy(false);
    }
  }
  const closed = Boolean(study.report);
  return (
    <article className="wo-card break-words">
      <h2>{study.request.brief}</h2>
      {study.request.discipline === "discovery" && (
        <Button asChild className="my-2"><Link href={`/lab-room?project=${study.project_id}&order=${study.id}`}>วางงานบนโต๊ะ 3D</Link></Button>
      )}
      <p>
        {disciplines[study.request.discipline]} ·{" "}
        <Badge>{states[study.state]}</Badge>
      </p>
      <p>
        มีผลแล้ว {study.stages.filter((s) => s.status === "complete").length}{" "}
        จาก {study.stages.length} ขั้น
      </p>
      {study.report && (
        <section
          aria-label="รายงานปิดใบงาน"
          className="rounded-xl border bg-muted/40 p-4"
        >
          <h3>รายงานปิดใบงาน</h3>
          <p>
            {states[study.report.decision]} · {study.report.note}
          </p>
          <p>
            ผู้ตัดสินใจ {study.report.actor} ·{" "}
            {new Date(study.report.at).toLocaleString("th-TH")}
          </p>
          {study.report.open_questions.length > 0 && (
            <p>งานที่ยังขาดผล · {study.report.open_questions.join(", ")}</p>
          )}
        </section>
      )}
      {study.events
        .filter((e) => e.structure)
        .map((e) => (
          <div className="my-3 border-l-2 border-teal-600 pl-3" key={e.id}>
            <b>{e.message}</b>
            <p>
              {e.structure!.application} · {e.structure!.observed_positions}{" "}
              ตำแหน่ง · สาย {e.structure!.chain}
            </p>
            <a href={e.structure!.url} target="_blank" rel="noreferrer">
              งานวิจัยและข้อมูล PDB {e.structure!.pdb}
            </a>
          </div>
        ))}
      <h3>แผนและหลักฐานรายขั้น</h3>
      {study.stages.map((s, i) => (
        <details
          key={s.id}
          className="my-2 rounded-lg border p-3"
          open={i === 0 || undefined}
        >
          <summary className="cursor-pointer">
            {s.id} · {s.title} · {states[s.status]}
          </summary>
          <p>
            {roles[s.role]}
            {s.due && " · ครบกำหนด " + s.due}
            {s.depends_on.length > 0 &&
              " · ใช้ผลจาก " + s.depends_on.join(", ")}
          </p>
          <p>
            <b>หลักการ</b> · {s.source.principle}
            <br />
            <b>ใช้กับขั้นนี้</b> · {s.application}
          </p>
          <p>
            เอกสารที่ agent ใช้จัดแผน ·{" "}
            <a href={s.source.url} target="_blank" rel="noreferrer">
              {s.source.title}
            </a>
            <br />
            {s.source.locator}
          </p>
          {study.events
            .filter((e) => e.stage_id === s.id)
            .map((e) => (
              <RecordDetail key={e.id} event={e} />
            ))}
          {study.events
            .filter((e) => e.reviewed_stage === s.id)
            .map((e) => (
              <aside key={e.id} className="my-3 rounded-lg bg-muted p-3">
                <strong>คำอธิบายจาก {roles[e.sender]}</strong>
                <p className="whitespace-pre-wrap">{e.message}</p>
                {e.sources_sent?.map((src, i) => (
                  <div key={i}>
                    เอกสารที่ส่งให้ Agent ·{" "}
                    <a href={src.url} target="_blank" rel="noreferrer">
                      {src.title}
                    </a>{" "}
                    · {src.locator}
                  </div>
                ))}
              </aside>
            ))}
          {owner && !closed && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => post("advice", { role: s.role, stage_id: s.id })}
            >
              ให้ Agent อธิบายหลักฐานผ่าน Groq
            </Button>
          )}
          {owner && s.status === "ready" && (
            <ResultForm step={s} post={post} busy={busy} />
          )}
        </details>
      ))}
      {study.request.discipline === "discovery" && (
        <section>
          <Button variant="outline" onClick={() => setBench(!bench)}>
            {bench ? "ปิดโต๊ะโปรตีน" : "เปิดโต๊ะโปรตีน 3D ในใบงาน"}
          </Button>
          {bench && (
            <ProteinWorkbench
              study={study}
              initialModel={
                study.events.find((e) => e.structure)?.structure?.pdb
              }
              onSave={owner && !closed ? onSave : undefined}
            />
          )}
          {study.events
            .filter((e) => e.pose)
            .map((e) => (
              <p key={e.id}>
                แบบฝึก {e.pose!.pdb} · RMSD {e.pose!.rmsd.toFixed(3)} Å ·{" "}
                {e.actor} ·{" "}
                <Link
                  href={`/lab-room/protein?pdb=${e.pose!.pdb}&angles=${e.pose!.angles.join(",")}`}
                >
                  เปิดท่าที่บันทึก
                </Link>
                {" · "}
                <a href={e.pose!.source_url} target="_blank" rel="noreferrer">
                  PDB {e.pose!.pdb}
                </a>
              </p>
            ))}
        </section>
      )}
      <details className="my-4">
        <summary>ประวัติใบงาน · {study.events.length} รายการ</summary>
        <ol className="wo-events">
          {study.events.map((e) => (
            <li key={e.id}>
              <b>{roles[e.sender]}</b> · {e.message}{" "}
              <time>{new Date(e.at).toLocaleString("th-TH")}</time>
            </li>
          ))}
        </ol>
        <small>{study.id}</small>
      </details>
      {owner && !closed && (
        <section>
          <label>
            เหตุผลของหัวหน้าแล็บ
            <Input
              maxLength={1500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <div className="wo-actions">
            <Button
              disabled={
                busy || !note.trim() || study.state !== "awaiting_approval"
              }
              onClick={() =>
                post("actions", {
                  action: "approve",
                  version: study.request.version,
                  note: note.trim(),
                })
              }
            >
              อนุมัติและปิดรายงาน
            </Button>
            <Button
              variant="outline"
              disabled={busy || !note.trim()}
              onClick={() =>
                post("actions", {
                  action: "reject",
                  version: study.request.version,
                  note: note.trim(),
                })
              }
            >
              ปิดพร้อมระบุเหตุที่ไม่อนุมัติ
            </Button>
          </div>
        </section>
      )}
      {error && <p role="alert">{error}</p>}
    </article>
  );
}
