"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState, useRef } from "react";
import { http, apiErrorMessage } from "@/lib/api";
import { loadProjectWorkspace } from "@/lib/project-workspace";
import type { Order, PendingOrder, Revision } from "./types";

function parseRows(text: string): Revision["ingredients"] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      const split = line.lastIndexOf(",");
      const name = line.slice(0, split).trim();
      const percent = line.slice(split + 1).trim();
      if (split < 1 || !name || !/^\d+(\.\d{1,6})?$/.test(percent))
        throw new Error("กรอกชื่อสารและ % คั่นด้วยจุลภาค หนึ่งสารต่อบรรทัด");
      return { name, percent };
    });
}

export default function NewOrder({
  project,
  onSave,
  intake,
}: {
  project: number;
  intake?: PendingOrder;
  onSave: (order: Order) => void;
}) {
  const [drafts] = useState(
    () => loadProjectWorkspace(project)?.formulas ?? [],
  );
  const [brief, setBrief] = useState(intake?.request.brief ?? "");
  const [versions, setVersions] = useState(["V1", "V2-A"]);
  const [lines, setLines] = useState(["", ""]);
  const [locked, setLocked] = useState("");
  const [endpoint, setEndpoint] = useState(intake?.request.endpoint ?? "identity");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const last = useRef({ key: "", id: "" });
  function change(pair: string[], index: number, value: string) {
    return pair.map((v, i) => (i === index ? value : v));
  }
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const [baseline, candidate] = lines.map((text, i) => ({
        version: versions[i],
        ingredients: parseRows(text),
      }));
      const data = {
        brief,
        baseline,
        candidate,
        endpoint,
        locked: locked
          .split(",")
          .map((n) => n.trim())
          .filter(Boolean),
      };
      const key = JSON.stringify(data);
      if (key !== last.current.key)
        last.current = { key, id: crypto.randomUUID() };
      const order = await http<Order>(`/api/lab/projects/${project}/orders`, {
        method: "POST",
        body: JSON.stringify({ ...data, id: intake?.id ?? last.current.id }),
      });
      onSave(order);
    } catch (e) {
      setError(
        e instanceof Error && e.name === "Error"
          ? e.message
          : apiErrorMessage(e, "ส่งใบงานไม่ได้"),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="wo-card" onSubmit={send}>
      <h2>{intake ? "แนบสูตรให้โจทย์เดิม" : "ส่งใบงานใหม่"}</h2>
      <label>
        โจทย์ของหัวหน้าโครงการ
        <Input
          required
          maxLength={1500}
          value={brief}
          readOnly={Boolean(intake)}
          onChange={(e) => setBrief(e.target.value)}
        />
      </label>
      <Button variant="outline"
        type="button"
        onClick={() => {
          if (!intake) setBrief("ตรวจชนิดสารและทบทวนการเปลี่ยนสัดส่วน");
          setLines(["Aqua, 95\nGlycerin, 5", "Aqua, 94\nGlycerin, 6"]);
          setVersions(["V1", "V2-A"]);
          setLocked("Glycerin");
          if (!intake) setEndpoint("identity");
        }}
      >
        ใช้ตัวอย่าง Aqua และ Glycerin
      </Button>
      <div className="wo-pair">
        {["สูตรต้นทาง", "รุ่นที่ขออนุมัติ"].map((label, i) => (
          <fieldset key={label}>
            <legend>{label}</legend>
            {drafts.length > 0 && (
              <label>
                นำเข้าจาก Studio
                <select
                  defaultValue=""
                  onChange={(e) => {
                    const d = drafts.find((f) => f.id === e.target.value);
                    if (d) {
                      setVersions(change(versions, i, d.name));
                      setLines(
                        change(
                          lines,
                          i,
                          d.items
                            .map(
                              (item) =>
                                `${item.name || item.smiles}, ${item.concentration}`,
                            )
                            .join("\n"),
                        ),
                      );
                    }
                  }}
                >
                  <option value="">เลือกสูตร</option>
                  {drafts.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              ชื่อรุ่น
              <Input
                required
                maxLength={120}
                value={versions[i]}
                onChange={(e) =>
                  setVersions(change(versions, i, e.target.value))
                }
              />
            </label>
            <label>
              ชื่อสาร, % โดยน้ำหนัก
              <textarea
                required
                rows={4}
                placeholder={"Aqua, 95\nGlycerin, 5"}
                value={lines[i]}
                onChange={(e) => setLines(change(lines, i, e.target.value))}
              />
            </label>
          </fieldset>
        ))}
      </div>
      <label>
        สารที่ล็อก (คั่นด้วยจุลภาค)
        <Input value={locked} onChange={(e) => setLocked(e.target.value)} />
      </label>
      <label>
        หลักฐานที่ต้องตรวจ
        <select value={endpoint} disabled={Boolean(intake)} onChange={(e) => setEndpoint(e.target.value)}>
          {Object.entries({
            identity: "ชนิดสาร",
            skin: "ข้อมูลด้านผิวหนัง",
            eye: "ข้อมูลด้านดวงตา",
            sens: "ข้อมูลการก่อภูมิแพ้",
            acute: "ข้อมูลความเป็นพิษเฉียบพลัน",
          }).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      <Button variant="default" disabled={busy}>
        {busy ? "กำลังส่ง…" : "ส่งให้นักวิจัย"}
      </Button>
    </form>
  );
}
