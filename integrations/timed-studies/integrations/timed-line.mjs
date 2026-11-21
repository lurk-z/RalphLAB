import { createServer } from "node:http";
import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";

export function bridge(settings, http = fetch) {
  for (const key of [
    "LINE_CHANNEL_SECRET",
    "LINE_CHANNEL_ACCESS_TOKEN",
    "LINE_USER_ID",
    "RALPHLAB_STUDY_ID",
    "RALPHLAB_STUDY_KEY",
    "RALPHLAB_SITE_URL",
  ]) {
    if (!settings[key]) throw Error("Set " + key);
  }
  const origin = new URL(settings.RALPHLAB_SITE_URL);
  if (
    origin.protocol !== "https:" ||
    !origin.hostname.endsWith(".chatgpt.site")
  )
    throw Error("Use the deployed ChatGPT Site origin");
  const id = settings.RALPHLAB_STUDY_ID;
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
    if (!r.ok) throw Error("RalphLAB " + r.status);
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
      signal: AbortSignal.timeout(12000),
    });
    if (
      !r.ok &&
      !(r.status === 409 && r.headers.has("x-line-accepted-request-id"))
    )
      throw Error("LINE " + r.status);
  }
  async function poll() {
    const { row, report, signal, sent } = await api();
    if (sent || !signal) return;
    const last = row.rounds.filter((r) => r.result).at(-1),
      next = row.rounds.find((r) => !r.result);
    const lines = [
      row.brief,
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
        "ตอบ ต่อ " +
          row.version +
          " เหตุผล หรือ หยุด " +
          row.version +
          " เหตุผล หรือ เพิ่ม " +
          row.version +
          " จำนวนชั่วโมง เหตุผล",
      );
    if (signal === "report")
      lines.push(
        row.state === "stopped" ? "ปิดงานตามคำสั่ง" : "ครบทุกกำหนดแล้ว",
      );
    lines.push(new URL("/lab-room/timed?id=" + id, origin).href);
    const bytes = createHash("sha256")
      .update(
        id + "|" + row.version + "|" + signal + "|" + settings.LINE_USER_ID,
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
        to: settings.LINE_USER_ID,
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
      e.source.userId !== settings.LINE_USER_ID ||
      e.message?.type !== "text"
    )
      return;
    const m = e.message.text.trim().match(/^(ต่อ|หยุด|เพิ่ม)\s+(\d+)\s+(.+)$/u);
    if (!m) return;
    const version = Number(m[2]);
    let note = m[3],
      hours;
    if (m[1] === "เพิ่ม") {
      const f = note.match(/^(\d+(?:\.\d+)?)\s+(.+)$/u);
      if (!f) return;
      hours = Number(f[1]);
      note = f[2];
    }
    const { row } = await api();
    if (row.version !== version || row.state !== "paused") return;
    const action = { ต่อ: "continue", หยุด: "stop", เพิ่ม: "followup" }[m[1]];
    await api({ action, version, note, hours });
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
  return { server, poll };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { server, poll } = bridge(process.env);
  server.listen(
    Number(process.env.PORT || 8788),
    process.env.HOST || "127.0.0.1",
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
  void run();
}
