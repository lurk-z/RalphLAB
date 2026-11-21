import assert from "node:assert/strict";
import test from "node:test";
import { applyTimedDecision, colorChangeFixture, TimedConflict, timedNext, timedReport, timedSignal } from "../src/lib/lab-room/timed.ts";
import { buildTimedGraph } from "../src/lib/lab-graph/timed-graph.ts";
import { buildCaseGraph, hasRecords, type LiveCase } from "../src/lib/lab-graph/live.ts";

const NOW = Date.UTC(2026, 10, 21, 8);

test("timed fixture: rounds 0/1/24/48 h, one measured value with its unit, paused for the owner", () => {
  const row = colorChangeFixture(NOW);
  assert.deepEqual(row.rounds.map((r) => r.hour), [0, 1, 24, 48]);
  assert.deepEqual(timedReport(row), { count: 1, total: 4, delta: null, last: 0.4, unit: "ΔE" });
  assert.equal(timedSignal(row, NOW), "issue");
  assert.equal(timedNext(row)?.hour, 1, "the 1-hour round is due and still has no value");
  assert.ok(row.rounds.slice(2).every((r) => !r.result && r.due > NOW), "future rounds stay pending");
});

test("a LINE decision updates the same study once; a replay of it changes nothing", () => {
  const row = colorChangeFixture(NOW);
  const reply = { action: "followup" as const, hours: 6, note: "เพิ่มรอบ", version: row.version };
  const after = applyTimedDecision(row, reply, NOW, "LINE");
  assert.equal(after.version, row.version + 1);
  assert.equal(after.state, "active");
  assert.equal(after.notes.filter((n) => n.action === "followup" && n.via === "LINE").length, 1);
  assert.equal(after.rounds.length, 5);
  assert.throws(() => applyTimedDecision(after, reply, NOW + 1000, "LINE"), TimedConflict);
  assert.equal(row.notes.length, 1, "the original row is not mutated");
});

test("the timed graph links the decision to the study, never to a formula version", () => {
  const decided = applyTimedDecision(colorChangeFixture(NOW), { action: "continue", note: "ติดตามต่อ", version: 3 }, NOW, "LINE");
  const g = buildTimedGraph(decided, true, NOW);
  const decision = Object.values(g.nodes).find((n) => n.kind === "decision")!;
  assert.ok(g.edges.some((e) => e.source === decision.id && e.target === "timed:demo-color-change:study"));
  assert.equal(Object.values(g.nodes).filter((n) => n.kind === "formula").length, 0);
  assert.ok(!g.edges.some((e) => e.verb.startsWith("ใช้กับ")));
  const states = Object.values(g.nodes).filter((n) => n.kind === "stage").map((n) => n.sublabel);
  assert.deepEqual(states, ["0.4 ΔE", "ถึงรอบแล้ว · ยังไม่มีค่า", "รอวัด", "รอวัด"]);
});

const order = (patch: Partial<LiveCase> = {}): LiveCase => ({
  id: "0f8fad5b-d9cb-469f-a165-70867728950e", project_id: 12, state: "awaiting_review",
  request: { brief: "ลดการระคายเคือง", baseline: { version: "V1", ingredients: [{ name: "Water", percent: "90" }] },
    candidate: { version: "V2", ingredients: [{ name: "Water", percent: "92" }] }, endpoint: "skin" },
  events: [
    { id: "e1", sequence: 1, at: "t", sender: "director", recipient: "researcher", message: "ส่งใบงาน" },
    { id: "e2", sequence: 2, at: "t", sender: "researcher", recipient: "formulator", message: "หลักฐาน",
      citations: [{ ingredient: "Glycerin", record: 3, evidence: [{ id: 41, source: "ECHA", review: "ระคายเคืองต่ำ", reference: "ECHA dossier", url: "https://echa.europa.eu/x" }] }] },
  ],
  report: null,
  ...patch,
});

test("live order: real source link and review are shown; 'used for V2' needs an approval", () => {
  const g = buildCaseGraph(order());
  const src = g.nodes["p12:source:evidence:41"];
  assert.equal(src.url, "https://echa.europa.eu/x");
  assert.ok(src.facts.some((f) => f.label === "ทบทวนไว้"));
  assert.ok(src.lists[0].items.some((i) => i.label.startsWith("ค้นพบ")));
  assert.ok(src.lists[0].items.some((i) => i.label.startsWith("ส่งต่อ")));
  assert.ok(!g.edges.some((e) => e.verb.startsWith("ใช้กับ")), "found and handed over is not 'used'");
  assert.ok(g.edges.some((e) => e.source === "p12:agent:director" && e.target === "p12:agent:researcher" && e.verb === "ส่งงาน"));
  const approved = buildCaseGraph(order({ state: "approved", report: { decision: "approved", actor: "u", at: "t", note: "ok" } }));
  assert.ok(approved.edges.some((e) => e.source === "p12:source:evidence:41" && e.verb === "ใช้กับ V2"));
});

test("an order with no sources, stages or decisions is reported as empty, not as an error", () => {
  const g = buildCaseGraph(order({ events: [], request: { brief: "รอแนบสูตร", endpoint: "skin" } }));
  assert.equal(hasRecords(g), false);
});

test("two studies of one project never share records", () => {
  const a = buildCaseGraph(order());
  const b = buildCaseGraph(order({ id: "1f8fad5b-d9cb-469f-a165-70867728950e", events: [] }));
  assert.ok(!Object.keys(b.nodes).some((id) => id.includes("evidence:41")));
  assert.notEqual(a.experimentId, b.experimentId);
});
