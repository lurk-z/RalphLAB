import assert from "node:assert/strict";
import test from "node:test";
import { readChatResponse } from "../src/lib/lab-demo/chat-response.ts";

test("JSON chat replies accept optional public activity and preserve the existing answer-only contract", async () => {
  const steps: string[] = [];
  assert.deepEqual(await readChatResponse(Response.json({ answer: "เดิม" }), s => steps.push(s)), { answer: "เดิม", proposals: [] });
  const result = await readChatResponse(Response.json({
    answer: "สรุป", public_steps: ["ตรวจข้อมูลสูตร", null],
    formula_proposals: [
      { name: "สูตรเต็ม", items: [{ name: "Water", concentration: 95 }, { name: "Glycerin", concentration: 5 }] },
      { name: "สูตรไม่ครบ", items: [{ name: "Glycerin", concentration: 5 }] },
    ],
  }), s => steps.push(s));
  assert.equal(result.answer, "สรุป");
  assert.deepEqual(result.proposals.map(({ name }) => name), ["สูตรเต็ม"]);
  assert.deepEqual(steps, ["ตรวจข้อมูลสูตร"]);
});

test("public API steps reach the UI before the final answer, including split Thai UTF-8 chunks", async () => {
  const encoder = new TextEncoder();
  let push!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(new ReadableStream<Uint8Array>({ start(c) { push = c; } }), { headers: { "content-type": "application/x-ndjson" } });
  const first = Promise.withResolvers<string>();
  const result = readChatResponse(response, first.resolve);
  const frame = encoder.encode('{"type":"step","label":"ตรวจสูตร"}\n');
  push.enqueue(frame.slice(0, 26));
  push.enqueue(frame.slice(26));
  assert.equal(await first.promise, "ตรวจสูตร");
  push.enqueue(encoder.encode('{"type":"final","answer":"สรุปผล"}'));
  push.close();
  assert.deepEqual(await result, { answer: "สรุปผล", proposals: [] });
});

test("a stream that disconnects before its final answer does not produce a false completion", async () => {
  const response = new Response('{"type":"step","label":"อ่านข้อมูล"}\n', { headers: { "content-type": "application/x-ndjson" } });
  await assert.rejects(readChatResponse(response, () => {}), /Incomplete/);
});
