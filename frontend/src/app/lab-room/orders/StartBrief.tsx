"use client";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { http, apiErrorMessage } from "@/lib/api";
import { disciplines, type Case, type Discipline } from "./types";

export default function StartBrief({
  project,
  onSave,
}: {
  project: number;
  onSave: (item: Case) => void;
}) {
  const [brief, setBrief] = useState("");
  const [type, setType] = useState<Discipline | "formula">("discovery");
  const [source, setSource] = useState("attach");
  const [endpoint, setEndpoint] = useState("identity");
  const [steps, setSteps] = useState(10);
  const [parallel, setParallel] = useState(false);
  const [date, setDate] = useState("");
  const [months, setMonths] = useState("0, 3, 6, 12, 24, 36");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const last = useRef({ key: "", id: "" });

  async function start(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !brief.trim()) return;
    const data =
      type === "formula"
        ? { brief: brief.trim(), source, endpoint }
        : {
            brief: brief.trim(),
            discipline: type,
            ...(type === "synthesis" && { reaction_steps: steps, parallel }),
            ...(type === "stability" && {
              start_date: date,
              months: months.split(",").map((m) => Number(m.trim())),
            }),
          };
    const key = JSON.stringify(data);
    if (last.current.key !== key)
      last.current = { key, id: crypto.randomUUID() };
    setBusy(true);
    setError("");
    try {
      const path = type === "formula" ? "briefs" : "studies";
      const result = await http<Case>(`/api/lab/projects/${project}/${path}`, {
        method: "POST",
        body: JSON.stringify({ ...data, id: last.current.id }),
      });
      setBrief("");
      last.current = { key: "", id: "" };
      onSave(result);
    } catch (e) {
      setError(apiErrorMessage(e, "เริ่มใบงานไม่ได้"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="my-4 p-5">
      <form onSubmit={start}>
        <h2>เริ่มจากโจทย์</h2>
        <label>
          ประเภทงาน
          <select
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
          >
            {Object.entries(disciplines).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
            <option value="formula">เปรียบเทียบสูตรสกินแคร์สองรุ่น</option>
          </select>
        </label>
        <label>
          โจทย์ของทีมแล็บ
          <textarea
            required
            maxLength={1500}
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="ระบุสิ่งที่อยากรู้ และชิ้นงานที่ต้องส่งมอบ"
          />
        </label>
        {type === "synthesis" && (
          <div className="wo-pair">
            <label>
              จำนวนขั้นปฏิกิริยา
              <Input
                type="number"
                min={parallel ? 3 : 2}
                max="30"
                required
                value={steps || ""}
                onChange={(e) => setSteps(Number(e.target.value))}
              />
            </label>
            <label>
              การส่งต่องาน
              <select
                value={parallel ? "parallel" : "series"}
                onChange={(e) => setParallel(e.target.value === "parallel")}
              >
                <option value="series">เรียงตามขั้น</option>
                <option value="parallel">
                  ทำสองสายคู่ขนาน แล้วรวมขั้นสุดท้าย
                </option>
              </select>
            </label>
          </div>
        )}
        {type === "stability" && (
          <div className="wo-pair">
            <label>
              วันเริ่มติดตาม
              <Input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label>
              เดือนที่เก็บข้อมูล นับจากวันเริ่ม
              <Input
                required
                value={months}
                pattern="[0-9]+(\s*,\s*[0-9]+)+"
                onChange={(e) => setMonths(e.target.value)}
              />
            </label>
          </div>
        )}
        {type === "formula" && (
          <div className="wo-pair">
            <label>
              ข้อมูลตั้งต้น
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
              >
                <option value="attach">แนบสูตรจริงภายหลัง</option>
                <option value="example">
                  ใช้ตัวอย่าง Aqua/Glycerin สองรุ่น
                </option>
              </select>
            </label>
            <label>
              ขอบเขตการตรวจ
              <select
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
              >
                <option value="identity">ชนิดสารและสัดส่วน</option>
                <option value="skin">ผิวหนัง</option>
                <option value="eye">ดวงตา</option>
                <option value="sens">การก่อภูมิแพ้</option>
                <option value="acute">ความเป็นพิษเฉียบพลัน</option>
              </select>
            </label>
          </div>
        )}
        {error && <p role="alert">{error}</p>}
        <Button disabled={busy || !brief.trim()}>
          {busy ? "กำลังรับโจทย์…" : "ส่งโจทย์ให้หัวหน้าแล็บ"}
        </Button>
      </form>
    </Card>
  );
}
