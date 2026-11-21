import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import { createLineDemo } from "./server.mjs";

test("signed LINE callbacks use the reply token and serve only the demo fixture", async t => {
  const secret = "unit-test-key";
  const replies = [];
  let failOnce = false;
  let time = "2026-11-21T16:59:00Z";
  const server = createLineDemo({
    secret, token: "unit-test-token", now: () => new Date(time),
    send: async (url, opts) => {
      assert.equal(url, "https://api.line.me/v2/bot/message/reply");
      assert.equal(opts.headers.Authorization, "Bearer unit-test-token");
      if (failOnce) { failOnce = false; return new Response(null, { status: 503 }); }
      replies.push(JSON.parse(opts.body));
      return new Response("{}");
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = "http://127.0.0.1:" + server.address().port + "/line/webhook";
  async function post(events, key = secret) {
    const body = JSON.stringify({ events });
    const signature = createHmac("sha256", key).update(body).digest("base64");
    const response = await fetch(url, { method: "POST", headers: { "x-line-signature": signature }, body });
    return response.status;
  }
  const event = (text, id) => ({ type: "message", message: { type: "text", text }, webhookEventId: id, replyToken: id });
  const daily = event("สรุปวันนี้", "reply-1");
  assert.equal(await post([daily], "wrong-test-key"), 401);
  assert.equal(await post([]), 200);
  assert.equal(replies.length, 0);
  assert.equal(await post([daily, { type: "follow" }]), 200);
  assert.equal(replies[0].replyToken, daily.replyToken);
  assert.match(replies[0].messages[0].text, /ข้อมูลสาธิต[\s\S]*2026-11-21[\s\S]*WO-001 · รอหัวหน้าอนุมัติ/);
  assert.equal(await post([daily]), 200);
  assert.equal(replies.length, 1);
  const lookup = event("ดูเคส WO-001", "reply-2");
  failOnce = true;
  assert.equal(await post([daily, lookup]), 502);
  assert.equal(await post([daily, lookup]), 200);
  assert.equal(replies.length, 2);
  assert.match(replies[1].messages[0].text, /เปรียบเทียบ Aqua และ Glycerin/);
  assert.equal(await post([event("ดูเคส WO-002", "reply-3")]), 200);
  assert.match(replies[2].messages[0].text, /ไม่พบเคส/);
  time = "2026-11-21T17:01:00Z";
  assert.equal(await post([event("สรุปวันนี้", "reply-4")]), 200);
  assert.match(replies[3].messages[0].text, /2026-11-22[\s\S]*0 รายการ/);
});
