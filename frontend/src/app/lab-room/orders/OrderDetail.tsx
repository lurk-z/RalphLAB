"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { FormulaCard } from "@/components/kit/formula-card";
import { useState, useRef } from "react";
import { http, apiErrorMessage } from "@/lib/api";
import { WORKBENCH_ROLE_LABEL as ROLE_LABEL } from "@/components/three/skincare-lab/agents/roles";
import { states, type Action, type Order } from "./types";

const roleNames: Record<string, string> = {
  ...ROLE_LABEL,
  head: "เจ้าของโครงการ",
};
export default function OrderDetail({
  order,
  owner,
  onSave,
}: {
  order: Order;
  owner: boolean;
  onSave: (o: Order) => void;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const last = useRef({ key: "", id: "" });
  const [role, setRole] = useState("researcher");
  async function consult() {
    if (busy) return;
    setBusy(true);
    setError("");
    const data = { role, expected_sequence: order.events.length };
    const key = JSON.stringify(data);
    if (last.current.key !== key)
      last.current = { key, id: crypto.randomUUID() };
    try {
      onSave(
        await http<Order>(
          `/api/lab/projects/${order.project_id}/orders/${order.id}/advice`,
          {
            method: "POST",
            body: JSON.stringify({ ...data, id: last.current.id }),
          },
          120000,
        ),
      );
    } catch (e) {
      setError(apiErrorMessage(e, "เรียก Agent ไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  }
  async function decide(action: Action) {
    if (!note.trim() || busy) return;
    setBusy(true);
    setError("");
    const data = {
      action,
      version: order.request.candidate.version,
      expected_sequence: order.events.length,
      note: note.trim(),
    };
    const key = JSON.stringify(data);
    if (last.current.key !== key)
      last.current = { key, id: crypto.randomUUID() };
    try {
      onSave(
        await http<Order>(
          `/api/lab/projects/${order.project_id}/orders/${order.id}/actions`,
          {
            method: "POST",
            body: JSON.stringify({ ...data, id: last.current.id }),
          },
        ),
      );
      setNote("");
    } catch (e) {
      setError(apiErrorMessage(e, "บันทึกคำตัดสินไม่ได้"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="wo-card">
      <h2>{order.request.brief}</h2>
      {order.report && <section aria-label="รายงานปิดใบงาน" className="my-3 rounded-xl border bg-muted/40 p-4">
        <h3>รายงานปิดใบงาน</h3>
        <p>{states[order.report.decision]} · {order.report.baseline} → {order.report.candidate}</p>
        <p>เหตุผล · {order.report.note}</p>
        <p>เปลี่ยน {order.report.changes.length} รายการ · มีหลักฐานอ้างอิงสำหรับ {order.report.citations.length} สาร</p>
        {order.report.open_questions.map(g=><div key={g}>{g}</div>)}
        <p className="text-xs text-muted-foreground">ผู้ตัดสินใจ {order.report.actor} · {new Date(order.report.at).toLocaleString("th-TH")}</p>
      </section>}
      <div className="my-3 flex flex-wrap items-center gap-2">
        <Badge variant={order.state === "approved" ? "default" : order.state === "rejected" ? "destructive" : "muted"}>{states[order.state]}</Badge>
        <span className="select-all break-all font-mono text-xs text-muted-foreground">{order.id}</span>
      </div>
      <div className="wo-pair">
        {[order.request.baseline, order.request.candidate].map((v, index) => (
          <FormulaCard key={v.version} name={v.version}
            productType={index === 0 ? "สูตรต้นทาง" : "รุ่นที่ขออนุมัติ"}
            ingredients={v.ingredients.map(i => ({name: i.name, percent: Number(i.percent)}))} />
        ))}
      </div>
      <p>สารที่ล็อก · {order.request.locked.join(", ") || "ไม่มี"}</p>
      <h3>ประวัติการส่งงาน</h3>
      <ol className="wo-events">
        {order.events.map((e) => (
          <li key={e.id}>
            <strong>
              {roleNames[e.sender]} → {roleNames[e.recipient]}
            </strong>{" "}
            <time>{new Date(e.at).toLocaleString("th-TH")}</time>
            <p>{e.message}</p>
            {e.application && <p>วิธีที่ใช้กับใบงาน · {e.application}</p>}
            {e.command && (
              <p>
                {
                  {
                    approve: "อนุมัติ",
                    reject: "ไม่อนุมัติ",
                    recheck: "ตรวจใหม่",
                  }[e.command.action]
                }{" "}
                · {e.version} · {e.actor}
              </p>
            )}
            {e.citations?.map((c) => (
              <div key={c.record}>
                {c.ingredient} · ทะเบียน #{c.record}{" "}
                {c.pubchem && (
                  <a href={c.pubchem} target="_blank" rel="noreferrer">
                    PubChem
                  </a>
                )}
                {c.evidence?.map((s) => (
                  <div key={s.id}>
                    หลักฐาน #{s.id} · {s.source} · {s.review} {s.reference}
                    {s.url && /^https?:\/\//i.test(s.url) && <> · <a href={s.url} target="_blank" rel="noreferrer">เปิดต้นฉบับ</a></>}
                  </div>
                ))}
              </div>
            ))}
            {e.changes?.map((c) => (
              <div key={c.name}>
                {c.name} · {c.before}% → {c.after}%{" "}
                {c.locked && <strong>· ขอเปลี่ยนสารที่ล็อก</strong>}
              </div>
            ))}
            {e.gaps?.map((g) => <div key={g}>{g}</div>)}
            {e.structures?.map((s) => (
              <div key={s.name}>
                {s.name} ·{" "}
                {
                  (
                    {
                      parsed: "อ่านโครงสร้างได้",
                      unavailable: "ไม่มีโครงสร้าง",
                      invalid: "โครงสร้างผิดรูปแบบ",
                    } as Record<string, string>
                  )[s.structure]
                }
              </div>
            ))}
            {e.tool && (
              <a href={e.tool[1]} target="_blank" rel="noreferrer">
                {e.tool[0]}
              </a>
            )}
          </li>
        ))}
      </ol>
      {owner && (
        <div className="wo-actions">
          <label>
            บทบาทที่ตรวจใบงาน
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              {Object.entries(ROLE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <Button variant="outline" disabled={busy} onClick={consult}>
            ส่งหลักฐานให้ Agent สรุปผ่าน Groq
          </Button>
        </div>
      )}
      {owner &&
        ["awaiting_approval", "needs_evidence"].includes(order.state) && (
          <section>
            <label>
              เหตุผลสำหรับรุ่น {order.request.candidate.version}
              <Input
                value={note}
                maxLength={1500}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <div className="wo-actions">
              <Button
                variant="default"
                disabled={busy || !note.trim()}
                onClick={() =>
                  decide(
                    order.state === "needs_evidence" ? "recheck" : "approve",
                  )
                }
              >
                {order.state === "needs_evidence"
                  ? "ตรวจหลักฐานอีกครั้ง"
                  : "อนุมัติรุ่นเสนอ"}
              </Button>
              <Button variant="outline"
                disabled={busy || !note.trim()}
                onClick={() => decide("reject")}
              >
                ไม่อนุมัติ
              </Button>
            </div>
          </section>
        )}
      {error && <p role="alert">{error}</p>}
    </article>
  );
}
