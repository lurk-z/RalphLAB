// Tam · Exercise the presenter handoff and private study notifications.
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import { bridge } from "../timed-studies/integrations/timed-line.mjs";

const owner = "U" + "1".repeat(32);
const other = "U" + "2".repeat(32);
const settings = {
  LOCAL_STUDY_PAIRING: "1",
  LINE_CHANNEL_SECRET: "fixture-secret",
  LINE_CHANNEL_ACCESS_TOKEN: "fixture-token",
  RALPHLAB_STUDY_ID: "sample",
  RALPHLAB_STUDY_KEY: "fixture-key",
  RALPHLAB_SITE_URL: "https://test.chatgpt.site",
  RALPHLAB_SITES_TOKEN: "fixture-site-token",
};

async function setup(t, overrides = {}) {
  const row = {
    id: "sample", brief: "Tam ทดสอบติดตามสี", state: "paused", version: 3,
    problem: "เครื่องวัดหยุด", exception: "พบปัญหาเครื่องวัด", metric: "สี", unit: "L*",
    start: Date.now(), rounds: [{ hour: 0, result: { value: 50, note: "ค่าตั้งต้น", recorded: Date.now() } }],
    notes: [{ at: Date.now(), action: "issue" }],
  };
  const calls = [], decisions = [], acceptedPushes = new Map();
  let sent = false, failAck = false;
  const service = bridge({ ...settings, ...overrides }, async (url, opts) => {
    const path = new URL(url);
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    if (path.hostname === "api.line.me") {
      assert.equal(opts.headers.Authorization, "Bearer fixture-token");
      if (path.pathname.endsWith("/push")) {
        assert.equal(body.to, owner);
        const key = opts.headers["X-Line-Retry-Key"];
        if (acceptedPushes.has(key))
          return new Response(null, { status: 409, headers: { "x-line-accepted-request-id": "accepted" } });
        acceptedPushes.set(key, body);
      }
      calls.push({ type: "line", body });
      return new Response("{}");
    }
    assert.equal(path.href, "https://test.chatgpt.site/api/timed/sample/relay");
    assert.equal(opts.headers["x-study-key"], "fixture-key");
    assert.equal(opts.headers["OAI-Sites-Authorization"], "Bearer fixture-site-token");
    calls.push({ type: "site", body });
    const signal = row.state === "paused" ? "issue" : row.state === "active" ? "observation" : "report";
    if (!body) return Response.json({ row, signal, sent, report: { count: 1, total: row.rounds.length } });
    if (body.action === "ack") {
      if (failAck) { failAck = false; return new Response(null, { status: 503 }); }
      sent = true;
    } else {
      if (row.version !== body.version || row.state !== "paused") return new Response(null, { status: 409 });
      decisions.push(body);
      row.version++;
      row.state = body.action === "stop" ? "stopped" : "active";
      if (body.action === "followup") row.rounds.push({ hour: body.hours });
      row.notes.push({ via: "LINE", action: body.action, note: body.note, at: Date.now() });
      sent = false;
    }
    return Response.json({ row });
  });
  service.server.listen(0, "127.0.0.1");
  await once(service.server, "listening");
  t.after(() => new Promise(resolve => service.server.close(resolve)));
  async function chat(text, userId = owner, type = "user", key = settings.LINE_CHANNEL_SECRET) {
    const body = JSON.stringify({ events: [{
      type: "message", source: { type, userId }, message: { type: "text", text }, replyToken: "test",
    }] });
    return (await fetch("http://127.0.0.1:" + service.server.address().port + "/line/webhook", {
      method: "POST", body,
      headers: { "x-line-signature": createHmac("sha256", key).update(body).digest("base64") },
    })).status;
  }
  return { ...service, chat, calls, decisions, acceptedPushes, row,
    failNextAck() { failAck = true; },
    finish() { row.state = "complete"; row.version++; sent = false; },
  };
}

test("in-person pairing restricts pushes, reads and decisions to one private chat", async t => {
  const s = await setup(t);
  await s.poll();
  assert.equal(await s.chat(s.pairingCommand, other, "user", "invalid-signature"), 401);
  await s.chat(s.pairingCommand, other, "group");
  await s.chat("จับคู่ wrong", other);
  await s.chat("ดูเคส", other);
  assert.equal(s.calls.length, 0);
  await s.chat(s.pairingCommand);
  assert.match(s.calls.at(-1).body.messages[0].text, /เชื่อม LINE/);
  const before = s.calls.length;
  await s.chat(s.pairingCommand, other);
  await s.chat("ดูเคส", other);
  await s.chat("หยุด 3 ทดสอบ", other);
  await s.chat("ดูเคส", owner, "group");
  assert.equal(s.calls.length, before);
  for (const command of ["ดูเคส", "ดูเคส sample", "สรุปวันนี้"]) {
    await s.chat(command);
    assert.match(s.calls.at(-1).body.messages[0].text, /Tam ทดสอบติดตามสี/);
  }
  await s.chat("ดูเคส outside");
  assert.match(s.calls.at(-1).body.messages[0].text, /ไม่พบใบงาน/);
  await s.poll();
  assert.match([...s.acceptedPushes.values()][0].messages[0].text, /พักงาน · เครื่องวัดหยุด[\s\S]+เพิ่ม 3/);
  await Promise.all([s.chat("เพิ่ม 3 0.02 ตรวจซ้ำ"), s.chat("เพิ่ม 3 0.02 ตรวจซ้ำ")]);
  await s.chat("เพิ่ม 3 0.02 ตรวจซ้ำ");
  assert.deepEqual(s.decisions, [{ action: "followup", version: 3, hours: 0.02, note: "ตรวจซ้ำ" }]);
  await s.poll();
  assert.match([...s.acceptedPushes.values()].at(-1).messages[0].text, /คำสั่งล่าสุดจาก LINE: เพิ่มรอบตรวจ/);
  s.finish();
  s.failNextAck();
  await assert.rejects(s.poll(), /503/);
  await s.poll();
  await s.poll();
  assert.equal(s.acceptedPushes.size, 3);
  assert.match([...s.acceptedPushes.values()].at(-1).messages[0].text, /ครบทุกกำหนดแล้ว/);
});

test("continue and stop use the current version and keep the submitted reason", async t => {
  for (const [command, action] of [["ต่อ", "continue"], ["หยุด", "stop"]]) {
    const s = await setup(t, { LINE_USER_ID: owner });
    assert.equal(s.pairingCommand, null);
    await s.chat(command + " 2 เก่า");
    assert.equal(s.decisions.length, 0);
    await s.chat(command + " 3 ทดสอบ");
    assert.deepEqual(s.decisions, [{ action, version: 3, note: "ทดสอบ" }]);
    assert.match(s.calls.at(-1).body.messages[0].text, /บันทึกแล้ว[\s\S]+รุ่น 4/);
    await s.poll();
    const text = [...s.acceptedPushes.values()].at(-1).messages[0].text;
    assert.match(text, /คำสั่งล่าสุดจาก LINE/);
    if (action === "stop") assert.match(text, /ปิดงานตามคำสั่ง/);
  }
});
