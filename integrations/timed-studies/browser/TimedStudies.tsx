import React, { useEffect, useState, useRef } from "react";
import "./timed.css";
import ResearchShelf from "./ResearchShelf";
const api = "/api/timed";
const page = "/lab-room/timed";
const stamp = (ms: number) =>
  new Date(ms).toLocaleString("th-TH", {
    dateStyle: "short",
    timeStyle: "short",
  });
const names: any = {
  active: "กำลังติดตาม",
  paused: "พักงาน · รอเจ้าของตอบ",
  complete: "รายงานเสร็จแล้ว",
  stopped: "ยุติการติดตาม",
};
async function send(path: string, data?: object) {
  const res = await fetch(api + path, {
    method: data ? "POST" : "GET",
    cache: "no-store",
    ...(data && {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    }),
  });
  const value = await res.json();
  if (!res.ok) throw Error(value.detail || "เชื่อมต่อไม่ได้");
  return value;
}
function Field({
  title,
  name,
  placeholder,
  type = "text",
  required = true,
  ...rest
}: any) {
  return (
    <label>
      {title}
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        {...rest}
      />
    </label>
  );
}
export default function TimedStudies() {
  const id = new URLSearchParams(location.search).get("id");
  const [rows, list] = useState<any[]>([]),
    [data, set] = useState<any>(null),
    [err, error] = useState(""),
    [busy, lock] = useState(false),
    [key, pair] = useState(""),
    [now, tick] = useState(Date.now());
  const draft = useRef({ text: "", id: "" });
  async function refresh() {
    const v = await send(id ? "/" + encodeURIComponent(id) : "");
    if (id) set(v);
    else list(v);
  }
  useEffect(() => {
    refresh().catch((e) => error(e.message));
    const t = setInterval(() => {
      tick(Date.now());
      if (id) refresh().catch((e) => error(e.message));
    }, 15000);
    return () => clearInterval(t);
  }, [id]);
  async function submit(e: any, fn: (b: any) => Promise<void>) {
    e.preventDefault();
    if (busy) return;
    lock(true);
    error("");
    const form = e.currentTarget;
    try {
      await fn(Object.fromEntries(new FormData(form)));
      form.reset();
    } catch (x) {
      error((x as Error).message);
      await refresh().catch(() => {});
    } finally {
      lock(false);
    }
  }
  const row = data?.row,
    next = row?.rounds.find((r: any) => !r.result);
  const post = async (b: any) =>
    set(await send("/" + id + "/events", { ...b, version: row.version }));
  return (
    <main className="timed">
      <nav>
        <a href="/">ห้องแล็บ</a> / <a href={page}>งานติดตามตามเวลา</a>
      </nav>
      <h1>{row ? row.brief : "ติดตามการทดลองตามเวลา"}</h1>
      {err && <p role="alert">{err}</p>}
      {!id && (
        <>
          <form
            onSubmit={(e) =>
              submit(e, async (b) => {
                const payload = {
                  ...b,
                  duration: Number(b.duration),
                  rounds: b.rounds.trim()
                    ? b.rounds.split(/[,\s]+/).map(Number)
                    : [],
                  rule: b.direction
                    ? {
                        direction: b.direction,
                        limit: b.limit === "" ? null : Number(b.limit),
                      }
                    : null,
                };
                const txt = JSON.stringify(payload);
                if (txt !== draft.current.text)
                  draft.current = { text: txt, id: crypto.randomUUID() };
                const saved = await send("", {
                  ...payload,
                  id: draft.current.id,
                });
                location.assign(page + "?id=" + saved.id);
              })
            }
          >
            <h2>หัวหน้าแล็บรับโจทย์</h2>
            <Field
              title="อยากติดตามอะไร"
              name="brief"
              placeholder="เช่น ติดตามสีของสูตร A เมื่อเก็บไว้ 48 ชั่วโมง"
            />
            <Field
              title="เป้าหมายของการทดลองคืออะไร"
              name="goal"
              placeholder="ระบุสิ่งที่ต้องการสรุปหลังจบรอบสุดท้าย"
            />
            <Field
              title="ติดตามตัวอย่างภายใต้เงื่อนไขใด"
              name="condition"
              placeholder="ระบุรหัสตัวอย่าง กลุ่มเปรียบเทียบ และเงื่อนไขที่ใช้"
            />
            <div className="pair">
              <Field
                title="ตัวชี้วัด"
                name="metric"
                placeholder="เช่น ค่าสี L*"
              />
              <Field
                title="หน่วยหรือชื่อสเกล"
                name="unit"
                placeholder="เช่น L*"
              />
            </div>
            <div className="pair">
              <Field
                title="การทดลองใช้เวลารวมกี่ชั่วโมง"
                name="duration"
                type="number"
                min="0.001"
                step="any"
                placeholder="48"
              />
              <Field
                title="สังเกตที่ชั่วโมงใดบ้าง"
                name="rounds"
                placeholder="1, 24, 48"
                required={false}
              />
            </div>
            <small>
              Agent เพิ่มรอบเริ่มต้นและรอบสิ้นสุดให้
              และคำนวณเวลานัดจากเวลาที่เริ่มใบงาน
            </small>
            <Field
              title="เจอปัญหาแบบไหนให้พักงานและถามคุณ"
              name="exception"
              placeholder="เช่น ตัวอย่างเสียหายหรือค่าที่วัดผิดจากเกณฑ์"
            />
            <div className="pair">
              <label>
                เกณฑ์ให้ Agent พักงานอัตโนมัติ
                <select name="direction">
                  <option value="">ให้ผู้สังเกตระบุปัญหา</option>
                  <option value="above">ค่าสูงกว่า</option>
                  <option value="below">ค่าต่ำกว่า</option>
                </select>
              </label>
              <Field
                title="ค่าเกณฑ์ (เมื่อเลือกเปรียบเทียบ)"
                name="limit"
                type="number"
                step="any"
                required={false}
              />
            </div>
            <button disabled={busy}>เริ่มนับเวลาและสร้างใบงาน</button>
          </form>
          <section>
            <h2>ใบงานของฉัน</h2>
            {rows.length ? (
              rows.map((r) => (
                <p key={r.id}>
                  <a href={page + "?id=" + r.id}>{r.brief}</a> ·{" "}
                  {names[r.state]}
                </p>
              ))
            ) : (
              <p>ยังไม่มีใบงาน</p>
            )}
          </section>
        </>
      )}
      {row && (
        <>
          <section>
            <strong>{names[row.state]}</strong>
            <h2>{row.goal}</h2>
            <p>{row.condition}</p>
            <p>
              แผนเดิม {row.duration} ชั่วโมง · เริ่ม {stamp(row.start)} ·
              รอบสุดท้าย {stamp(row.rounds.at(-1).due)}
            </p>
            <p>
              เงื่อนไขพักงาน · {row.exception}{" "}
              {row.rule &&
                " · " +
                  row.metric +
                  (row.rule.direction === "above" ? " > " : " < ") +
                  row.rule.limit +
                  " " +
                  row.unit}
            </p>
          </section>
          <section>
            <h2>รายงานการเปลี่ยนแปลง</h2>
            <p>
              บันทึกแล้ว {data.report.count} จาก {data.report.total} รอบ
              {data.report.delta !== null &&
                " · ผลต่างจากครั้งแรกถึงครั้งล่าสุด " +
                  data.report.delta.toLocaleString("th-TH") +
                  " " +
                  row.unit}
            </p>
            <ol>
              {row.rounds.map((r: any) => (
                <li key={r.due}>
                  <b>
                    ชั่วโมง {Number(r.hour.toFixed(3))} · {stamp(r.due)}
                  </b>
                  <div>
                    {r.followup && "ติดตามเพิ่ม · " + r.followup + " · "}
                    {r.result
                      ? row.metric +
                        " " +
                        r.result.value +
                        " " +
                        row.unit +
                        " · " +
                        r.result.note +
                        (r.result.issue ? " · พบปัญหา" : "")
                      : row.state === "stopped"
                        ? "ยุติก่อนบันทึก"
                        : now >= r.due
                          ? "ถึงรอบ · รอผลที่สังเกต"
                          : "รอถึงกำหนด"}
                  </div>
                  {r.result && (
                    <small>
                      วัดจริง {stamp(r.result.observed)} · แหล่งข้อมูล{" "}
                      {r.result.source}
                    </small>
                  )}
                </li>
              ))}
            </ol>
            {row.notes.map((n: any, i: number) => (
              <div key={i}>
                <p>
                  {stamp(n.at)} · {n.via} ·{" "}
                  {
                    (
                      {
                        issue: "พบปัญหา",
                        continue: "ติดตามต่อ",
                        stop: "ยุติ",
                        followup: "เพิ่มรอบ",
                      } as any
                    )[n.action]
                  }{" "}
                  · {n.note}
                </p>
                {n.references?.map((r: any) => (
                  <p key={r.url}>
                    หลักฐานที่เลือกไว้ขณะตัดสินใจ ·{" "}
                    <a href={r.url} target="_blank" rel="noreferrer">
                      {r.title}
                    </a>{" "}
                    · {r.note}
                  </p>
                ))}
              </div>
            ))}
          </section>
          {row.state === "active" && next && now >= next.due && (
            <form
              onSubmit={(e) =>
                submit(e, async (b) =>
                  post({
                    action: "observe",
                    value: Number(b.value),
                    note: b.note,
                    source: b.source,
                    observed: b.observed
                      ? new Date(b.observed).getTime()
                      : Date.now(),
                    issue: b.issue === "on",
                  }),
                )
              }
            >
              <h2>บันทึกผลรอบ {next.hour} ชั่วโมง</h2>
              <Field
                title={row.metric + " (" + row.unit + ")"}
                name="value"
                type="number"
                step="any"
              />
              <Field title="สิ่งที่สังเกตเห็น" name="note" />
              <Field title="หลักฐานหรือรหัสบันทึกต้นทาง" name="source" />
              <Field
                title="เวลาที่วัดจริง (เว้นว่างเพื่อใช้เวลาปัจจุบัน)"
                name="observed"
                type="datetime-local"
                required={false}
                step="1"
              />
              <label>
                <input type="checkbox" name="issue" /> พบปัญหา ให้ Agent พักงาน
              </label>
              <button disabled={busy}>บันทึกผลและอัปเดตรายงาน</button>
            </form>
          )}
          {row.state === "active" && (
            <details>
              <summary>รายงานปัญหาระหว่างรอบ</summary>
              <form
                onSubmit={(e) =>
                  submit(e, async (b) =>
                    post({ action: "issue", note: b.note }),
                  )
                }
              >
                <Field
                  title="เกิดอะไรขึ้น และต้องการให้เจ้าของตัดสินใจเรื่องใด"
                  name="note"
                />
                <button disabled={busy}>พักงานและขอคำตัดสิน</button>
              </form>
            </details>
          )}
          {row.state === "paused" && (
            <form
              onSubmit={(e) =>
                submit(e, async (b) => post({ ...b, hours: Number(b.hours) }))
              }
            >
              <h2>Agent รอคำตัดสินของคุณ</h2>
              <p>{row.problem}</p>
              <label>
                ให้ทำอะไรต่อ
                <select name="action">
                  <option value="continue">ติดตามต่อตามแผน</option>
                  <option value="followup">เพิ่มรอบสังเกต</option>
                  <option value="stop">ยุติและเก็บรายงาน</option>
                </select>
              </label>
              <Field
                title="เพิ่มรอบในอีกกี่ชั่วโมง (เมื่อเลือกเพิ่มรอบ)"
                name="hours"
                type="number"
                step="any"
                required={false}
              />
              <Field title="เหตุผลหรือประเด็นที่ต้องติดตาม" name="note" />
              <button disabled={busy}>ยืนยันคำตัดสิน</button>
            </form>
          )}
          <ResearchShelf
            scope={"timed/" + row.id}
            problem={row.state === "paused" ? row.problem : ""}
          />
          <details>
            <summary>เชื่อมใบงานกับ LINE ของทีม</summary>
            <p>
              ตัวเชื่อม LINE ของทีมต้องทำงานอยู่จึงจะส่งแจ้งเตือนได้
              ใบงานจะพักรอเมื่อพบปัญหาแม้ยังไม่ได้เชื่อม LINE
            </p>
            <button
              onClick={async () => {
                try {
                  pair((await send("/" + id + "/pair", {})).key);
                } catch (e) {
                  error((e as Error).message);
                }
              }}
            >
              ออกรหัสเชื่อมต่อใหม่
            </button>
            {key && (
              <p>
                ส่งให้ผู้ดูแลตัวเชื่อมผ่านช่องทางส่วนตัว <code>{key}</code>
              </p>
            )}
          </details>
        </>
      )}
    </main>
  );
}
