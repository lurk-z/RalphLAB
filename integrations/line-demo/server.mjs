// Tam · LINE OA phone demo. Only the sample work order is available here.
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import reports from "../../frontend/public/tam-demo/workorder-reports.js";

const replyUrl = "https://api.line.me/v2/bot/message/reply";
const maxBytes = 1024 * 1024;

export function createLineDemo({ secret, token, send = fetch, now = () => new Date() }) {
  if (!secret || !token) throw new Error("Set LINE_CHANNEL_SECRET and LINE_CHANNEL_ACCESS_TOKEN");
  const order = reports.makeOrder("WO-001", reports.exampleId, now().toISOString());
  // A webhook may be retried after one reply from its batch already succeeded.
  const delivered = new Map();

  async function reply(event) {
    if (event?.type !== "message" || event.mode === "standby" ||
        event.message?.type !== "text" || typeof event.message.text !== "string" || !event.replyToken) return;
    const key = event.webhookEventId || event.replyToken;
    const time = now();
    for (const [id, delivery] of delivered) {
      if (delivery.expires > time.getTime()) break;
      delivered.delete(id);
    }
    if (delivered.has(key)) return delivered.get(key).pending;
    const text = "RalphLAB · ข้อมูลสาธิต\n" + reports.report(event.message.text, [order], order.alias, time);
    const pending = send(replyUrl, {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ replyToken: event.replyToken, messages: [{ type: "text", text }] }),
      signal: AbortSignal.timeout(5000),
    }).then(response => {
      if (!response.ok) throw new Error("LINE reply failed (HTTP " + response.status + ")");
    });
    delivered.set(key, { pending, expires: time.getTime() + 10 * 60 * 1000 });
    try { await pending; }
    catch (error) { delivered.delete(key); throw error; }
  }

  return createServer(async (req, res) => {
    const status = code => { res.writeHead(code); res.end(); };
    if (req.url !== "/line/webhook") return status(404);
    if (req.method !== "POST") return status(405);
    try {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > maxBytes) return status(413);
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks);
      const expected = createHmac("sha256", secret).update(raw).digest("base64");
      const signature = req.headers["x-line-signature"];
      if (typeof signature !== "string") return status(401);
      const actual = Buffer.from(signature);
      if (actual.length !== expected.length || !timingSafeEqual(actual, Buffer.from(expected))) return status(401);
      let payload;
      try { payload = JSON.parse(raw.toString("utf8")); } catch { return status(400); }
      if (!Array.isArray(payload?.events)) return status(400);
      const results = await Promise.allSettled(payload.events.map(reply));
      if (results.some(r => r.status === "rejected")) {
        console.error("LINE reply failed. Check the access token and network connection.");
        return status(502);
      }
      status(200);
    } catch {
      if (!res.headersSent) status(500);
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 8787);
  const server = createLineDemo({
    secret: process.env.LINE_CHANNEL_SECRET,
    token: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  });
  server.listen(port, "127.0.0.1", () => console.log("Tam · LINE demo ready at http://127.0.0.1:" + port + "/line/webhook"));
}
