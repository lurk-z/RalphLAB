"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Vector3 } from "three";
import { Button } from "@/components/ui/button";
import { apiErrorMessage, http } from "@/lib/api";
import type { Study } from "../orders/types";
import ProteinView, { fold, type Protein } from "./ProteinView";
import "./protein.css";

type Props = {
  study?: Study;
  onSave?: (s: Study) => void;
  initialAngles?: number[];
  initialModel?: string;
};
export default function ProteinWorkbench(props: Props) {
  const [model, setModel] = useState(
    props.initialModel === "3I40" ? "insulin" : "gfp",
  );
  return (
    <>
      <label>
        เลือกโครงสร้างโปรตีน
        <select value={model} onChange={(e) => setModel(e.target.value)}>
          <option value="gfp">GFP · โปรตีนเรืองแสง</option>
          <option value="insulin">Human insulin · อินซูลินมนุษย์</option>
        </select>
      </label>
      <Workbench
        key={model}
        {...props}
        model={model}
        initialAngles={
          model === (props.initialModel === "3I40" ? "insulin" : "gfp")
            ? props.initialAngles
            : undefined
        }
      />
    </>
  );
}

function Workbench({
  study,
  onSave,
  initialAngles,
  model,
}: Props & { model: string }) {
  const insulin = model === "insulin";
  const [data, setData] = useState<Protein | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [fragment, setFragment] = useState(Boolean(study || initialAngles));
  const [overlay, setOverlay] = useState(true);
  const [angles, setAngles] = useState(initialAngles ?? [65, -80]);
  const [camera, setCamera] = useState<[number, number, number]>([
    0.45, -0.25, 1,
  ]);
  const [saved, setSaved] = useState("");
  const last = useRef({ key: "", id: "" });
  useEffect(() => {
    const c = new AbortController();
    setError("");
    http<Protein>("/api/lab/protein/" + model, { signal: c.signal })
      .then((d) => {
        if (!c.signal.aborted) setData(d);
      })
      .catch((e) => {
        if (!c.signal.aborted)
          setError(apiErrorMessage(e, "โหลดโครงสร้างไม่ได้"));
      });
    return () => c.abort();
  }, [attempt, model]);
  const chain = useMemo(
    () =>
      data
        ? fragment
          ? data.trace.filter(
              (r) => r.number >= data.first && r.number <= data.last,
            )
          : data.trace
        : [],
    [data, fragment],
  );
  const points = useMemo(
    () =>
      fragment && data
        ? fold(chain, data.hinges, angles)
        : chain.map((r) => new Vector3(...r.xyz)),
    [chain, angles, data, fragment],
  );
  const rmsd = chain.length
    ? Math.sqrt(
        points.reduce(
          (sum, p, i) =>
            sum + p.distanceToSquared(new Vector3(...chain[i].xyz)),
          0,
        ) / chain.length,
      )
    : 0;
  async function save() {
    if (!data || !study || !onSave || busy) return;
    const payload = {
      model: data.model,
      angles,
      expected_sequence: study.events.length,
    };
    const key = JSON.stringify(payload);
    if (last.current.key !== key)
      last.current = { key, id: crypto.randomUUID() };
    setBusy(true);
    setError("");
    setSaved("");
    try {
      onSave(
        await http<Study>(
          `/api/lab/projects/${study.project_id}/orders/${study.id}/protein-poses`,
          {
            method: "POST",
            body: JSON.stringify({ ...payload, id: last.current.id }),
          },
        ),
      );
      setSaved("บันทึกมุมและโครงสร้างอ้างอิงลงประวัติใบงานแล้ว");
    } catch (e) {
      setError(apiErrorMessage(e, "แนบแบบจำลองไม่ได้"));
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return (
      <div role="status">
        {error || "กำลังโหลดโครงสร้างโปรตีน…"}{" "}
        {error && (
          <Button onClick={() => setAttempt((v) => v + 1)}>ลองใหม่</Button>
        )}
      </div>
    );
  return (
    <section className="protein-bench" aria-label="โต๊ะโปรตีนสามมิติ">
      <div className="protein-top">
        <div>
          <h2>{data.title}</h2>
          <p>
            <i>{data.organism}</i> · สาย {data.chain}
          </p>
        </div>
        <a href={data.source_url} target="_blank" rel="noreferrer">
          PDB {data.pdb} ↗
        </a>
      </div>
      <div className="protein-tabs" aria-label="มุมมอง">
        <button
          type="button"
          aria-pressed={!fragment}
          onClick={() => {
            setFragment(false);
            setCamera([0.45, -0.25, 1]);
          }}
        >
          ดูโครงสร้างทั้งสาย
        </button>
        <button
          type="button"
          aria-pressed={fragment}
          onClick={() => {
            setFragment(true);
            setCamera([0.45, -0.25, 1]);
          }}
        >
          {insulin ? "ลองจัดสาย A และ B" : "ลองพับสายโปรตีน"}
        </button>
      </div>
      <div className="protein-stage">
        <div className="protein-caption">
          Cα ·{" "}
          {insulin
            ? "สาย A สีเขียว · สาย B สีฟ้า"
            : fragment
              ? "กรดอะมิโน 17–28"
              : `${chain.length} ตำแหน่งที่มีพิกัด`}
        </div>
        <ProteinView
          chain={chain}
          points={points}
          overlay={fragment && overlay}
          fragment={fragment}
          camera={camera}
          onRotate={(dx, dy) => setCamera(([x, y, z]) => [x + dx, y + dy, z])}
        />
        <div className="protein-controls">
          <span>ลากเพื่อหมุน</span>
          <button
            type="button"
            aria-label="ซูมออก"
            onClick={() =>
              setCamera(([x, y, z]) => [x, y, Math.max(0.5, z - 0.15)])
            }
          >
            −
          </button>
          <button
            type="button"
            aria-label="ซูมเข้า"
            onClick={() =>
              setCamera(([x, y, z]) => [x, y, Math.min(2, z + 0.15)])
            }
          >
            +
          </button>
          <button type="button" onClick={() => setCamera([0.45, -0.25, 1])}>
            คืนมุมมอง
          </button>
        </div>
      </div>
      {fragment && (
        <div className="protein-puzzle">
          <h3>
            {insulin
              ? "จัดแนวสาย B เทียบกับสาย A"
              : "พับสายให้ใกล้กับโครงสร้างที่วัดได้"}
          </h3>
          <p>
            {insulin
              ? "สาย A อยู่กับที่ ลองหมุนสาย B สองแกนให้กลับมาตรงกับรอยเส้นประจากโครงสร้างผลึกอินซูลิน"
              : "ปรับมุมทั้งสองจุด เทียบแนว Cα กับเส้นประจากผลึก GFP ในกรอบพิกัดเดียวกัน"}{" "}
            ยิ่งทับกัน ค่าความคลาดเคลื่อนยิ่งใกล้ศูนย์
          </p>
          {!insulin && (
            <div className="protein-sequence" aria-label="ลำดับกรดอะมิโน">
              {chain.map((r, i) => (
                <span key={r.number} data-segment={Math.floor(i / 4)}>
                  {r.name} <small>{r.number}</small>
                </span>
              ))}
            </div>
          )}
          <div className="protein-sliders">
            {(insulin
              ? ["หมุนสาย B รอบแกน X", "หมุนสาย B รอบแกน Y"]
              : data.hinges.map(
                  (k) => "มุมที่ " + chain[k].name + " " + chain[k].number,
                )
            ).map((label, i) => (
              <label key={label}>
                {label} · {angles[i]}°
                <input
                  type="range"
                  min="-180"
                  max="180"
                  step="1"
                  value={angles[i]}
                  onChange={(e) => {
                    const deg = Number(e.target.value);
                    setAngles((a) => a.map((v, j) => (i === j ? deg : v)));
                    setSaved("");
                  }}
                />
              </label>
            ))}
          </div>
          <output className="protein-score">
            RMSD <b>{rmsd.toFixed(3)} Å</b>
          </output>
          <p>
            ค่านี้วัดระยะห่างของแบบฝึกกับพิกัดอ้างอิง
            ส่วนการประเมินฤทธิ์ยาต้องใช้ผลทดลองแยกต่างหาก
          </p>
          <div className="wo-actions">
            <label className="protein-check">
              <input
                type="checkbox"
                checked={overlay}
                onChange={(e) => setOverlay(e.target.checked)}
              />{" "}
              แสดงเส้นอ้างอิง
            </label>
            <Button
              variant="outline"
              onClick={() => {
                setAngles([...data.start_angles]);
                setSaved("");
              }}
            >
              {insulin ? "เริ่มจัดสายใหม่" : "เริ่มพับใหม่"}
            </Button>
            {onSave && (
              <Button
                disabled={
                  busy ||
                  !!saved ||
                  !study ||
                  !["in_progress", "awaiting_approval"].includes(study.state)
                }
                onClick={save}
              >
                แนบแบบจำลองลงใบงาน
              </Button>
            )}
          </div>
          {saved && <p role="status">{saved}</p>}
          {error && <p role="alert">{error}</p>}
        </div>
      )}
      <footer>
        พิกัดจากโครงสร้างผลึก {data.pdb} ·{" "}
        <a href={data.source_url} target="_blank" rel="noreferrer">
          ข้อมูลต้นฉบับและงานวิจัย
        </a>{" "}
        ·{" "}
        <a
          href={"https://www.rcsb.org/3d-view/" + data.pdb}
          target="_blank"
          rel="noreferrer"
        >
          เปิดแบบจำลองเต็มใน Mol*
        </a>{" "}
        ·{" "}
        <a href="https://fold.it" target="_blank" rel="noreferrer">
          เล่น Foldit
        </a>
      </footer>
    </section>
  );
}
