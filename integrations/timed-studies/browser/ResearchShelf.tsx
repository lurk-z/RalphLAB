import React, { useEffect, useState } from "react";
import "./research.css";

type Base = { name: string; title: string; url: string; use: string };
type Review = { decision: string; note: string; hypothesis: string };
type Source = {
  id: string;
  title: string;
  url: string;
  kind: string;
  detail: string;
  review?: Review;
};
type Used = { title: string; url: string; note: string };
type Run = {
  id: string;
  at: number;
  gap: string;
  role: string;
  status: string;
  paper: string;
  software: string;
  baseline: Base;
  hypothesis: string;
  check: string;
  prior: Used[];
  sources: Source[];
  unavailable: string[];
};
type Shelf = { roles: Record<string, Base>; runs: Run[] };
export default function ResearchShelf({
  scope,
  problem = "",
}: {
  scope: string;
  problem?: string;
}) {
  const [shelf, setShelf] = useState<Shelf>(),
    [role, setRole] = useState("researcher"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const path = "/api/research/" + scope;
  useEffect(() => {
    let live = true,
      serial = 0;
    async function read() {
      const ticket = ++serial;
      try {
        const res = await fetch(path, { cache: "no-store" });
        if (!res.ok) throw Error("โหลดคลังอ้างอิงไม่ได้");
        const next = await res.json();
        if (live && ticket === serial) setShelf(next);
      } catch (e) {
        if (live) setError((e as Error).message);
      }
    }
    void read();
    const t = setInterval(read, 12000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [path, problem]);
  async function submit(
    e: React.FormEvent<HTMLFormElement>,
    extra: Record<string, string>,
  ) {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget;
    const body = { ...Object.fromEntries(new FormData(form)), ...extra };
    setBusy(true);
    setError("");
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const next = await res.json();
      if (!res.ok) throw Error(next.detail || "บันทึกไม่ได้");
      setShelf(next);
      form.reset();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const base = shelf?.roles[role];
  return (
    <section className="research-shelf">
      <h2>คลังอ้างอิงของงานนี้</h2>
      <form
        onSubmit={(e) =>
          submit(e, { action: "search", role, id: crypto.randomUUID() })
        }
      >
        <label>
          Agent ที่ต้องการหลักฐาน
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {Object.entries(shelf?.roles || {}).map(([k, v]) => (
              <option key={k} value={k}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        {base && (
          <p>
            แหล่งตั้งต้น ·{" "}
            <a href={base.url} target="_blank" rel="noreferrer">
              {base.title}
            </a>
            <br />
            {base.use}
          </p>
        )}
        <label>
          หลักฐานเดิมยังตอบเรื่องใดไม่ได้
          <input
            name="gap"
            defaultValue={problem}
            maxLength={800}
            required
            placeholder="เช่น ค่าสีที่เปลี่ยนเกิดจากตัวอย่างหรือเครื่องวัด"
          />
        </label>
        <label>
          คำค้นสาธารณะ (เว้นว่างให้ Agent เลือก)
          <input
            name="keywords"
            maxLength={110}
            placeholder="เช่น colorimetry"
          />
        </label>
        <small>Crossref และ GitHub จะได้รับเฉพาะคำค้น</small>
        <button disabled={busy || !shelf}>
          {busy ? "กำลังบันทึก…" : "ค้นงานวิจัยและโอเพนซอร์ส"}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {shelf?.runs.map((r, i) => (
        <details key={r.id} open={i === 0 || undefined}>
          <summary>
            {r.baseline.name} · {r.gap}
          </summary>
          <p>
            {new Date(r.at).toLocaleString("th-TH")} · Crossref “{r.paper}” ·
            GitHub “{r.software}”
          </p>
          <p>
            <strong>สมมติฐานตั้งต้นที่ยังต้องตรวจ</strong> · {r.hypothesis}
            <br />
            {r.check}
          </p>
          {r.prior?.map((p) => (
            <p key={p.url}>
              หลักฐานเดิมที่นำกลับมาพิจารณา ·{" "}
              <a href={p.url} target="_blank" rel="noreferrer">
                {p.title}
              </a>{" "}
              · {p.note}
            </p>
          ))}
          {r.status === "searching" && (
            <p>
              {Date.now() - r.at > 60000
                ? "การค้นยังไม่เสร็จ สามารถเริ่มค้นใหม่ได้"
                : "กำลังค้นฐานข้อมูล"}
            </p>
          )}
          {r.unavailable.length > 0 && (
            <p>
              ติดต่อ {r.unavailable.join(" และ ")} ไม่สำเร็จ ·
              ลองค้นอีกครั้งภายหลัง
            </p>
          )}
          {r.status === "done" && !r.sources.length && (
            <p>
              ยังไม่มีหลักฐานเพิ่มเติม ลองปรับคำค้นหรือส่งคำถามให้ผู้เชี่ยวชาญ
            </p>
          )}
          {r.sources.map((s) => (
            <article key={s.id}>
              <small>
                {s.kind === "paper"
                  ? "บทความ · Crossref"
                  : "ซอฟต์แวร์ · GitHub"}
              </small>
              <h3>
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.title}
                </a>
              </h3>
              <p>{s.detail}</p>
              {s.review && (
                <p>
                  <b>
                    {s.review.decision === "use"
                      ? "เลือกใช้กับงานนี้"
                      : "พักแหล่งนี้"}
                  </b>{" "}
                  · {s.review.note}
                  {s.review.hypothesis && (
                    <>
                      <br />
                      สมมติฐานที่บันทึก · {s.review.hypothesis}
                    </>
                  )}
                </p>
              )}
              <details>
                <summary>
                  {s.review ? "แก้ผลการทบทวน" : "ทบทวนแหล่งนี้"}
                </summary>
                <form
                  onSubmit={(e) =>
                    submit(e, { action: "review", id: r.id, source: s.id })
                  }
                >
                  <label>
                    การนำไปใช้
                    <select
                      name="decision"
                      defaultValue={s.review?.decision || "use"}
                    >
                      <option value="use">เลือกใช้กับงานนี้</option>
                      <option value="dismiss">พักแหล่งนี้</option>
                    </select>
                  </label>
                  <label>
                    ข้อมูลส่วนใดช่วยตอบโจทย์ หรือมีข้อจำกัดอะไร
                    <input
                      name="note"
                      maxLength={650}
                      defaultValue={s.review?.note}
                      required
                    />
                  </label>
                  <label>
                    สมมติฐานหลังอ่านต้นฉบับ (ถ้ามี)
                    <input
                      name="hypothesis"
                      maxLength={600}
                      defaultValue={s.review?.hypothesis}
                    />
                  </label>
                  <button disabled={busy}>บันทึกผลทบทวน</button>
                </form>
              </details>
            </article>
          ))}
        </details>
      ))}
    </section>
  );
}
