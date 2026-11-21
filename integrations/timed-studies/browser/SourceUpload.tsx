import React, { useState } from "react";
export default function SourceUpload({
  path,
  roles,
  update,
}: {
  path: string;
  roles: Record<string, { name: string }>;
  update: (value: any) => void;
}) {
  const [busy, setBusy] = useState(false),
    [status, setStatus] = useState("");
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    if (!(file instanceof File) || !file.size) {
      setStatus("เลือกไฟล์ต้นฉบับ");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setStatus("เลือกไฟล์ที่มีขนาดไม่เกิน 10 MiB");
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      const meta = {
        name: file.name,
        role: data.get("role"),
        locator: data.get("locator"),
        note: data.get("note"),
        origin: data.get("origin"),
      };
      const r = await fetch(path + "/files", {
        method: "POST",
        headers: {
          "content-type": "application/octet-stream",
          "x-ralph-file": encodeURIComponent(JSON.stringify(meta)),
        },
        body: file,
      });
      const result = await r.json();
      if (!r.ok) throw Error(result.detail || "อัปโหลดไม่สำเร็จ");
      update(result);
      form.reset();
      setStatus("เก็บไฟล์ต้นฉบับในคลังของงานนี้แล้ว");
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details>
      <summary>แนบไฟล์ต้นฉบับให้ Agent</summary>
      <form onSubmit={save}>
        <label>
          ไฟล์ PDF, TXT, MD, CSV หรือ JSON · สูงสุด 10 MiB
          <input
            name="file"
            type="file"
            accept=".pdf,.txt,.md,.csv,.json"
            required
          />
        </label>
        <label>
          บทบาทที่ใช้เอกสาร
          <select name="role" defaultValue="researcher">
            {Object.entries(roles).map(([k, v]) => (
              <option key={k} value={k}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          หน้าหรือส่วนที่ใช้
          <input
            name="locator"
            maxLength={180}
            placeholder="เช่น หน้า 4 ตาราง 2 หรือแถว 5–12"
            required
          />
        </label>
        <label>
          ข้อมูลส่วนนี้ช่วยตอบโจทย์อย่างไร
          <input name="note" maxLength={650} required />
        </label>
        <label>
          ลิงก์ต้นทาง (ถ้ามี)
          <input
            name="origin"
            type="url"
            maxLength={1000}
            placeholder="https://…"
          />
        </label>
        <button disabled={busy}>
          {busy ? "กำลังเก็บไฟล์…" : "เก็บไฟล์และใช้เป็นหลักฐาน"}
        </button>
        {status && <p role="status">{status}</p>}
      </form>
    </details>
  );
}
