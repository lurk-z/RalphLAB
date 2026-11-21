// Tam · LINE pairing and notifications for a single RalphLAB timed study.
import { createServer } from "node:http";
import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";

const thaiDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
});
const stateLabels = { active: "กำลังติดตาม", paused: "พักรอการตัดสินใจ", complete: "เสร็จสิ้น", stopped: "ยุติตามคำสั่ง" };
const decisionLabels = { continue: "ติดตามต่อ", followup: "เพิ่มรอบตรวจ", stop: "หยุดติดตาม" };

function decisionOptions(version) {
  return [
    "เลือกคำสั่งแล้วใส่เหตุผล",
    "ต่อ " + version + " เหตุผล",
    "เพิ่ม " + version + " จำนวนชั่วโมง เหตุผล",
    "หยุด " + version + " เหตุผล",
  ].join("\n");
}

export function bridge(settings, http = fetch) {
  for (const key of [
    "LINE_CHANNEL_SECRET",
    "LINE_CHANNEL_ACCESS_TOKEN",
    "RALPHLAB_STUDY_ID",
    "RALPHLAB_STUDY_KEY",
    "RALPHLAB_SITE_URL",
  ]) {
    if (!settings[key]) throw Error("Set " + key);
  }
  let recipient = settings.LINE_USER_ID;
  if (recipient && !/^U[0-9a-f]{32}$/i.test(recipient))
    throw Error("Invalid LINE user ID");
  if (!recipient && settings.LOCAL_STUDY_PAIRING !== "1")
    throw Error("Set LINE_USER_ID or enable in-person pairing");
  const pairingCommand = recipient ? null : "จับคู่ " + randomBytes(16).toString("hex");
  const expires = Date.now() + 10 * 60_000;
  const origin = new URL(settings.RALPHLAB_SITE_URL);
  if (
    origin.protocol !== "https:" ||
    !origin.hostname.endsWith(".chatgpt.site")
  )
    throw Error("Use the deployed ChatGPT Site origin");
  const id = settings.RALPHLAB_STUDY_ID;
  const studyLink = new URL("/lab-room/timed", origin);
  studyLink.searchParams.set("id", id);
  async function api(data) {
    const headers = {
      "x-study-key": settings.RALPHLAB_STUDY_KEY,
      "content-type": "application/json",
    };
    if (settings.RALPHLAB_SITES_TOKEN)
      headers["OAI-Sites-Authorization"] =
        "Bearer " + settings.RALPHLAB_SITES_TOKEN;
    const r = await http(
      new URL("/api/timed/" + encodeURIComponent(id) + "/relay", origin),
      {
        headers,
        method: data ? "POST" : "GET",
        body: data && JSON.stringify(data),
        redirect: "error",
        signal: AbortSignal.timeout(12000),
      },
    );
    if (!r.ok) throw Object.assign(Error("RalphLAB " + r.status), { status: r.status });
    return r.json();
  }
  async function message(endpoint, body, retryKey) {
    const r = await http("https://api.line.me/v2/bot/message/" + endpoint, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + settings.LINE_CHANNEL_ACCESS_TOKEN,
        "content-type": "application/json",
        ...(retryKey && { "X-Line-Retry-Key": retryKey }),
      },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(12000),
    });
    if (
      !r.ok &&
      !(r.status === 409 && r.headers.has("x-line-accepted-request-id"))
    )
      throw Error("LINE " + r.status);
  }
  async function poll() {
    if (!recipient) return;
    const { row, report, signal, sent } = await api();
    if (sent || !signal) return;
    const last = row.rounds.filter((r) => r.result).at(-1),
      next = row.rounds.find((r) => !r.result);
    const lines = [
      "RalphLAB · " + row.brief,
      "บันทึกแล้ว " + report.count + "/" + report.total + " รอบ",
    ];
    if (last)
      lines.push(
        "ผลล่าสุด " +
          row.metric +
          " " +
          last.result.value +
          " " +
          row.unit +
          " · " +
          last.result.note,
      );
    if (signal === "due")
      lines.push("ถึงรอบสังเกตที่ " + next.hour + " ชั่วโมง");
    if (signal === "issue")
      lines.push(
        "พักงาน · " + row.problem,
        "เงื่อนไข " + row.exception,
        decisionOptions(row.version),
      );
    if (signal === "report")
      lines.push(
        row.state === "stopped" ? "ปิดงานตามคำสั่ง" : "ครบทุกกำหนดแล้ว",
      );
    const decision = row.notes?.at(-1);
    if (decision?.via === "LINE" && decisionLabels[decision.action])
      lines.push("คำสั่งล่าสุดจาก LINE: " + decisionLabels[decision.action] + " · " + decision.note);
    lines.push(studyLink.href);
    const bytes = createHash("sha256")
      .update(
        id + "|" + row.version + "|" + signal + "|" + recipient,
      )
      .digest();
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = bytes.subarray(0, 16).toString("hex"),
      retryKey = [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20),
      ].join("-");
    await message(
      "push",
      {
        to: recipient,
        messages: [{ type: "text", text: lines.join("\n") }],
      },
      retryKey,
    );
    await api({ action: "ack", version: row.version, signal });
  }
  async function event(e) {
    if (
      e.type !== "message" ||
      e.mode === "standby" ||
      e.source?.type !== "user" ||
      !/^U[0-9a-f]{32}$/i.test(e.source.userId || "") ||
      e.message?.type !== "text"
    )
      return;
    const command = e.message.text.trim();
    const answer = text => e.replyToken && message("reply", {
      replyToken: e.replyToken, messages: [{ type: "text", text }],
    });
    if (!recipient) {
      if (command !== pairingCommand || Date.now() >= expires) return;
      recipient = e.source.userId;
      console.log("Tam - LINE recipient paired for this study session.");
    }
    if (e.source.userId !== recipient) return;
    if (pairingCommand && command === pairingCommand)
      return answer("เชื่อม LINE สำหรับใบงานนี้แล้ว พิมพ์ คำสั่ง เพื่อดูเมนู");
    if (command === "คำสั่ง") return answer([
      "คำสั่งที่ใช้ได้",
      "ดูเคส — ดูรายการเคสและสถานะ",
      "ดูเคส ตามด้วยรหัส — เปิดรายละเอียด",
      "สรุปวันนี้ — ดูความเคลื่อนไหววันนี้",
      "เมื่อใบงานพัก ให้ตอบ ต่อ / เพิ่ม / หยุด ตามตัวอย่างในข้อความแจ้งเตือน",
    ].join("\n"));
    if (command === "ดูเคส" || command === "ดูเคส " + id || command === "สรุปวันนี้") {
      const { row, report } = await api();
      if (command === "ดูเคส") return answer([
        "เคสที่เชื่อมกับ LINE นี้ 1 รายการ",
        id + " · " + stateLabels[row.state] + " · " + row.brief,
        "เปิดรายละเอียดโดยพิมพ์ ดูเคส " + id,
      ].join("\n"));
      const lines = ["RalphLAB · " + row.brief, "สถานะ: " + stateLabels[row.state],
        "บันทึกแล้ว " + report.count + "/" + report.total + " รอบ"];
      if (command === "สรุปวันนี้") {
        const today = thaiDay.format(new Date());
        const activity = [row.start, ...row.notes.map(note => note.at),
          ...row.rounds.filter(round => round.result).map(round => round.result.recorded)];
        const active = activity.some(at => thaiDay.format(at) === today);
        lines.unshift("สรุปวันนี้ " + today + " · ใบงานที่เชื่อมไว้มีความเคลื่อนไหว " + Number(active) + " รายการ");
      }
      if (row.state === "paused") lines.push("พักงาน · " + row.problem, decisionOptions(row.version));
      lines.push(studyLink.href);
      return answer(lines.join("\n"));
    }
    if (command.startsWith("ดูเคส ")) return answer("ไม่พบใบงานนี้ในบัญชีที่เชื่อมไว้");
    const m = command.match(/^(ต่อ|หยุด|เพิ่ม)\s+(\d+)\s+(.+)$/u);
    if (!m) return answer("พิมพ์ คำสั่ง เพื่อดูเมนู");
    const version = Number(m[2]);
    let note = m[3], hours;
    if (m[1] === "เพิ่ม") {
      const f = note.match(/^(\d+(?:\.\d+)?)\s+(.+)$/u);
      if (!f) return answer("ตัวอย่าง: เพิ่ม " + version + " 1 ตรวจซ้ำหลังแก้เครื่องวัด");
      hours = Number(f[1]);
      note = f[2];
    }
    const { row } = await api();
    // The version is bound to the study in the owner-scoped relay. A repeated
    // or delayed webhook must never apply the decision to a later pause.
    const action = { ต่อ: "continue", หยุด: "stop", เพิ่ม: "followup" }[m[1]];
    if (row.version !== version || row.state !== "paused") {
      if (e.deliveryContext?.isRedelivery) return;
      return answer("คำสั่งนี้ใช้กับสถานะปัจจุบันไม่ได้ พิมพ์ ดูเคส เพื่อดูใบงานล่าสุด");
    }
    let updated;
    try { updated = await api({ action, version, note, hours }); }
    catch (error) {
      if (error.status === 409) return answer("ใบงานเปลี่ยนแล้ว พิมพ์ ดูเคส เพื่อดูสถานะล่าสุด");
      if (error.status === 422) return answer("บันทึกไม่ได้ กรุณาตรวจจำนวนชั่วโมงและเหตุผล แล้วส่งคำสั่งอีกครั้ง");
      throw error;
    }
    return answer("บันทึกแล้ว · " + decisionLabels[action] + " · " + note +
      "\nสถานะ: " + stateLabels[updated.row.state] + " · รุ่น " + updated.row.version);
  }
  const server = createServer(async (req, res) => {
    if (req.url !== "/line/webhook" || req.method !== "POST") {
      res.writeHead(404).end();
      return;
    }
    try {
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1048576) {
          res.writeHead(413).end();
          return;
        }
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks),
        signature = Buffer.from(
          req.headers["x-line-signature"] || "",
          "base64",
        );
      const expected = createHmac("sha256", settings.LINE_CHANNEL_SECRET)
        .update(body)
        .digest();
      if (
        signature.length !== expected.length ||
        !timingSafeEqual(signature, expected)
      ) {
        res.writeHead(401).end();
        return;
      }
      const { events } = JSON.parse(body.toString());
      if (!Array.isArray(events)) {
        res.writeHead(400).end();
        return;
      }
      for (const e of events) await event(e);
      res.writeHead(200).end();
    } catch {
      res.writeHead(503).end();
    }
  });
  return { server, poll, pairingCommand };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const settings = { ...process.env };
  if (settings.RALPHLAB_STUDY_URL) {
    const link = new URL(settings.RALPHLAB_STUDY_URL);
    if (link.origin !== settings.RALPHLAB_SITE_URL || link.pathname !== "/lab-room/timed")
      throw Error("Use the study link from the team's RalphLAB Site");
    settings.RALPHLAB_STUDY_ID = link.searchParams.get("id");
  }
  const { server, poll, pairingCommand } = bridge(settings);
  server.listen(
    Number(process.env.PORT || 8788),
    process.env.HOST || "127.0.0.1",
    () => {
      console.log("Tam - study webhook is listening on port " + server.address().port);
      if (pairingCommand) {
        console.log("Send this one-time command from the intended recipient's private OA chat within 10 minutes:");
        console.log(pairingCommand);
      }
      void run();
    },
  );
  async function run() {
    try {
      await poll();
    } catch (e) {
      console.error("LINE relay polling failed", e.message);
    } finally {
      setTimeout(run, 30000);
    }
  }
}
