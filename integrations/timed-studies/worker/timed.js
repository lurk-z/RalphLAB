const HOUR = 3600000;
const requireTimed = (ok, message, status = 422) =>
  requireValue(ok, status, message);
function numeric(val, name) {
  requireTimed(
    typeof val === "number" && Number.isFinite(val),
    "กรุณาระบุ " + name,
  );
  return val;
}
function hours(val) {
  numeric(val, "จำนวนชั่วโมง");
  requireTimed(
    val > 0 && val <= 24 * 366 * 5,
    "ระยะเวลาต้องมากกว่า 0 และไม่เกิน 5 ปี",
  );
  return val;
}
function timedPlan(b, now) {
  const total = hours(b.duration);
  requireTimed(
    Array.isArray(b.rounds) && b.rounds.length <= 64,
    "ระบุรอบวัดสูงสุด 64 รอบ",
  );
  const rounds = [...new Set([0, ...b.rounds, total])].sort((a, b) => a - b);
  requireTimed(
    rounds.every((x) => Number.isFinite(x) && x >= 0 && x <= total),
    "ทุกรอบต้องอยู่ในระยะเวลาที่กำหนด",
  );
  let rule = null;
  if (b.rule) {
    requireTimed(
      ["above", "below"].includes(b.rule.direction),
      "เลือกเกณฑ์สูงกว่าหรือต่ำกว่า",
    );
    rule = {
      direction: b.rule.direction,
      limit: numeric(b.rule.limit, "ค่าเกณฑ์"),
    };
  }
  return {
    id: uuid(b.id),
    brief: label(b.brief),
    goal: label(b.goal),
    condition: label(b.condition),
    metric: label(b.metric, 150),
    unit: label(b.unit, 60),
    exception: label(b.exception),
    duration: total,
    rule,
    rounds: rounds.map((h) => ({ hour: h, due: now + h * HOUR })),
    start: now,
    state: "active",
    version: 1,
    notes: [],
  };
}
function timedNext(row) {
  return row.rounds.find((r) => !r.result);
}
function timedSignal(row, now) {
  if (row.state === "paused") return "issue";
  if (row.state === "complete" || row.state === "stopped") return "report";
  return timedNext(row)?.due <= now ? "due" : "observation";
}
const noticeNumber = (row, signal) =>
  row.version * 10 +
  ["due", "issue", "report", "observation"].indexOf(signal) +
  1;
function timedReport(row) {
  const values = row.rounds.filter((r) => r.result).map((r) => r.result.value);
  return {
    count: values.length,
    total: row.rounds.length,
    delta: values.length > 1 ? values.at(-1) - values[0] : null,
    last: values.at(-1) ?? null,
    unit: row.unit,
  };
}
function advanceTimed(row, b, now, via) {
  requireTimed(
    row.version === b.version,
    "ข้อมูลเปลี่ยนแล้ว โปรดเปิดใบงานล่าสุด",
    409,
  );
  const next = timedNext(row);
  if (b.action === "issue") {
    requireTimed(row.state === "active", "งานนี้ไม่ได้กำลังติดตาม", 409);
    row.problem = label(b.note, 800);
    row.notes.push({ action: "issue", note: row.problem, at: now, via });
    row.state = "paused";
  } else if (b.action === "observe") {
    requireTimed(
      row.state === "active" && next && next.due <= now,
      "ยังไม่ถึงรอบหรือใบงานกำลังรอคำตอบ",
      409,
    );
    const value = numeric(b.value, "ค่าที่สังเกต");
    const observed = numeric(b.observed, "เวลาสังเกตจริง");
    const previous = row.rounds.filter((r) => r.result).at(-1);
    requireTimed(
      observed >= Math.max(next.due, previous?.result.observed ?? 0) &&
        observed <= now,
      "ตรวจเวลาที่วัดจริงเทียบกับรอบ",
    );
    const flagged =
      b.issue === true ||
      (row.rule &&
        (row.rule.direction === "above"
          ? value > row.rule.limit
          : value < row.rule.limit));
    next.result = {
      value,
      observed,
      recorded: now,
      source: label(b.source, 500),
      note: label(b.note, 800),
      issue: Boolean(flagged),
    };
    if (flagged) row.problem = next.result.note;
    row.state = flagged ? "paused" : timedNext(row) ? "active" : "complete";
  } else {
    requireTimed(
      row.state === "paused" &&
        ["continue", "stop", "followup"].includes(b.action),
      "ยังไม่มีประเด็นรอการตัดสินใจ",
      409,
    );
    const note = label(b.note, 500);
    if (b.action === "followup") {
      const due = now + hours(b.hours) * HOUR;
      requireTimed(
        row.rounds.length < 128 && !row.rounds.some((r) => r.due === due),
        "รอบซ้ำหรือจำนวนรอบเกินกำหนด",
      );
      row.rounds.push({ hour: (due - row.start) / HOUR, due, followup: note });
      row.rounds.sort((a, b) => a.due - b.due);
    }
    row.state =
      b.action === "stop" ? "stopped" : timedNext(row) ? "active" : "complete";
    row.notes.push({ action: b.action, note, at: now, via });
  }
  row.version++;
  return row;
}
async function timedDigest(secret) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
async function timedAPI(request, env, url) {
  const db = env.DB.withSession ? env.DB.withSession("first-primary") : env.DB;
  const user = identity(request)?.id;
  const path = url.pathname.split("/").filter(Boolean);
  const id = path[2],
    action = path[3],
    relay = action === "relay",
    now = Date.now();
  requireTimed(path.length <= 4, "ไม่พบเส้นทาง", 404);
  if (!relay) requireTimed(user, "กรุณาเข้าสู่ระบบ ChatGPT", 401);
  if (!id) {
    if (request.method === "GET") {
      const rows = await db
        .prepare(
          "SELECT payload FROM timed_studies WHERE owner=? ORDER BY created DESC",
        )
        .bind(user)
        .all();
      return json(rows.results.map((r) => JSON.parse(r.payload)));
    }
    requireTimed(request.method === "POST", "ไม่รองรับวิธีนี้", 405);
    const body = await bodyOf(request, url),
      row = timedPlan(body, now);
    const added = await db
      .prepare(
        "INSERT INTO timed_studies(id,owner,created,version,payload) VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
      )
      .bind(row.id, user, now, 1, JSON.stringify(row))
      .run();
    if (!added.meta.changes) {
      const old = await db
        .prepare("SELECT payload FROM timed_studies WHERE id=? AND owner=?")
        .bind(row.id, user)
        .first();
      requireTimed(old, "รหัสงานซ้ำ", 409);
      const saved = JSON.parse(old.payload);
      requireTimed(
        equal(
          timedPlan(body, saved.start),
          timedPlan(
            {
              ...saved,
              rounds: saved.rounds
                .filter((r) => !r.followup)
                .map((r) => r.hour),
            },
            saved.start,
          ),
        ),
        "รหัสนี้ใช้กับแผนอื่นแล้ว",
        409,
      );
      return json(saved);
    }
    return json(row, 201);
  }
  const saved = await db
    .prepare("SELECT * FROM timed_studies WHERE id=?")
    .bind(uuid(id))
    .first();
  if (relay) {
    const token = request.headers.get("x-study-key") || "";
    requireTimed(
      token.length === 64 && saved?.pair_hash === (await timedDigest(token)),
      "สิทธิ์เชื่อมต่อไม่ถูกต้อง",
      403,
    );
  } else requireTimed(saved && saved.owner === user, "ไม่พบใบงาน", 404);
  const row = JSON.parse(saved.payload);
  const signal = timedSignal(row, now);
  if (request.method === "GET" && (!action || relay))
    return json({
      row,
      report: timedReport(row),
      signal,
      sent: saved.sent_version === noticeNumber(row, signal),
    });
  requireTimed(request.method === "POST", "ไม่รองรับวิธีนี้", 405);
  const b = await bodyOf(request, url);
  if (action === "pair") {
    const secret =
      crypto.randomUUID().replaceAll("-", "") +
      crypto.randomUUID().replaceAll("-", "");
    await db
      .prepare("UPDATE timed_studies SET pair_hash=?,sent_version=0 WHERE id=?")
      .bind(await timedDigest(secret), id)
      .run();
    return json({ key: secret });
  }
  if (relay && b.action === "ack") {
    if (b.signal === signal)
      await db
        .prepare(
          "UPDATE timed_studies SET sent_version=? WHERE id=? AND version=? AND pair_hash=?",
        )
        .bind(noticeNumber(row, signal), id, b.version, saved.pair_hash)
        .run();
    return json({ ok: true });
  }
  requireTimed(relay || action === "events", "ไม่พบเส้นทาง", 404);
  requireTimed(
    !relay || ["continue", "stop", "followup"].includes(b.action),
    "กรอกผลจากหน้าใบงาน",
    403,
  );
  const prev = row.version;
  advanceTimed(row, b, now, relay ? "LINE" : "web");
  const changed = await db
    .prepare(
      "UPDATE timed_studies SET payload=?, version=? WHERE id=? AND version=? AND (?=0 OR pair_hash=?)",
    )
    .bind(
      JSON.stringify(row),
      row.version,
      id,
      prev,
      relay ? 1 : 0,
      saved.pair_hash ?? "",
    )
    .run();
  requireTimed(
    changed.meta.changes === 1,
    "ข้อมูลเปลี่ยนแล้ว โปรดโหลดใหม่",
    409,
  );
  return json({ row, report: timedReport(row), signal: timedSignal(row, now) });
}
