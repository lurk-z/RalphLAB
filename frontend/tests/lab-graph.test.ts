import assert from "node:assert/strict";
import test from "node:test";
import { createDemoStore, createLabDemo, createMockTransport, DEMO_PLAYBOOK } from "../src/lib/lab-demo/engine.ts";
import { currentScope, type DemoScope } from "../src/lib/lab-demo/events.ts";
import { createMockSearchAdapter } from "../src/lib/lab-demo/research.ts";
import {
  agentNodeId, branchNodeId, buildProjectGraph, emptyExploration, evidenceNodeId, focusAgent, formulaNodeId,
  pathTo, toggleExpanded, visibleNodes, type ProjectGraph,
} from "../src/lib/lab-graph/model.ts";

const brief = "เปิดโครงการลดข้อกังวลด้านการระคายเคืองของสูตรทำความสะอาด";
const owner = { id: "guest", label: "เจ้าของโครงการจำลอง", owner: true, simulated: true };

/** The recorded D01 study. The owner approves the Curator's search unless `approve` is false. */
async function study(projectId = "p1", store = createDemoStore(), approve = true) {
  const scope: DemoScope = { userId: "guest", projectId, mode: "demo" };
  const demo = createLabDemo({ store, scope, experimentId: "D01", transport: createMockTransport({ faults: [{ attempt: 1, kind: "ack-lost" }] }), playbook: DEMO_PLAYBOOK, search: createMockSearchAdapter() });
  const result = await demo.submit("director", brief);
  await demo.idle();
  demo.decideGroup(result.jobId!, true);
  await demo.idle();
  if (approve) for (const r of Object.values(demo.state().research)) demo.decideResearch(r.requestId, "approve", owner, currentScope(projectId, r));
  await demo.idle();
  return { store, scope, state: demo.state(), demo };
}

const edge = (g: ProjectGraph, source: string, target: string) => g.edges.find((e) => e.source === source && e.target === target);

test("the Chemist's graph matches the recorded D01 study", async () => {
  const { state } = await study();
  const g = buildProjectGraph(state);
  const chemist = agentNodeId("p1", "formulator");
  const branches = g.children[chemist].map((id) => g.nodes[id].label);
  assert.deepEqual(branches, ["โจทย์ที่รับ", "สูตรที่สร้าง", "งานที่ส่งต่อ", "หลักฐานที่ใช้"]);
  assert.deepEqual(g.children[branchNodeId("p1", "formulator", "received")], [agentNodeId("p1", "director")]);
  assert.deepEqual(g.children[branchNodeId("p1", "formulator", "sent")], [agentNodeId("p1", "analyst")]);

  // Lineage: the branch lists V1; V1 reveals its actual child V2-A.
  const v1 = formulaNodeId("p1", "D01", "V1"), v2 = formulaNodeId("p1", "D01", "V2-A");
  assert.deepEqual(g.children[branchNodeId("p1", "formulator", "created")], [v1]);
  assert.ok(g.children[v1].includes(v2));
  assert.equal(edge(g, v1, v2)?.verb, "แตกรุ่น");
  assert.equal(g.nodes[formulaNodeId("p1", "D01", "V2-B")], undefined, "V2-B is not in the project");

  // Arrows follow the events: the Curator supplies E01, the Chemist uses it.
  const e01 = evidenceNodeId("p1", "D01", "E01");
  const curator = agentNodeId("p1", "researcher");
  assert.equal(edge(g, curator, e01)?.verb, "ส่งหลักฐาน");
  assert.equal(edge(g, e01, branchNodeId("p1", "formulator", "used"))?.verb, "ใช้เป็นหลักฐาน");
  assert.equal(edge(g, e01, v2)?.verb, "ใช้เป็นหลักฐาน");
  assert.ok(g.nodes[e01].message, "E01 opens the exact handoff message");
  assert.ok(state.messages.some((m) => m.messageId === g.nodes[e01].message!.messageId));
  assert.ok(g.nodes[e01].facts.some((f) => f.label === "สูตรที่เกี่ยวข้อง" && f.value === "V2-A"));

  // The Curator's sources: no query was recorded; the record it opened was.
  const queries = g.children[branchNodeId("p1", "researcher", "queries")].map((id) => g.nodes[id]);
  assert.deepEqual(queries.map((n) => [n.kind, n.label]), [["missing", "ไม่มีคำค้นที่บันทึกไว้"]]);
  const docs = g.children[branchNodeId("p1", "researcher", "documents")].map((id) => g.nodes[id]);
  assert.deepEqual(docs.map((n) => n.kind), ["document"]);
  assert.equal(docs[0].eventIds.length, 1);

  // V2-A: parent, change and evidence.
  const facts = Object.fromEntries(g.nodes[v2].facts.map((f) => [f.label, f]));
  assert.equal(facts["รุ่นแม่"].link, v1);
  assert.match(facts["สิ่งที่เปลี่ยน"].value, /เบส B 10% → 8%/);
  assert.ok(g.nodes[v2].lists.some((l) => l.items.some((i) => i.link === e01)));

  // Every role has recorded work to explore.
  for (const role of ["director", "formulator", "analyst", "researcher", "evaluator"] as const) {
    assert.ok(g.children[agentNodeId("p1", role)]?.length, role);
  }
});

test("focusing the Chemist reproduces Chemist → E01 → Curator → source in one view", async () => {
  const g = buildProjectGraph((await study()).state);
  let view = focusAgent(g, emptyExploration(), "formulator");
  let parents = visibleNodes(g, view);
  const e01 = evidenceNodeId("p1", "D01", "E01");
  const curator = agentNodeId("p1", "researcher");
  assert.ok(parents.has(e01) && parents.has(curator));
  assert.ok(parents.has(formulaNodeId("p1", "D01", "V2-A")));
  view = toggleExpanded(view, curator);
  parents = visibleNodes(g, view);
  const documents = branchNodeId("p1", "researcher", "documents");
  assert.ok(parents.has(branchNodeId("p1", "researcher", "queries")) && parents.has(documents));
  view = toggleExpanded(view, documents);
  parents = visibleNodes(g, view);
  const doc = g.children[documents][0];
  assert.deepEqual(pathTo(parents, doc).map((id) => g.nodes[id].label),
    ["Formulation Chemist", "หลักฐานที่ใช้", "E01 · เบส B", "Chemical Data Curator", "เอกสารต้นทาง", "บันทึกระเบียน E01"]);
});

test("collapsing one branch keeps E01 while another expanded branch still reaches it", async () => {
  const g = buildProjectGraph((await study()).state);
  const e01 = evidenceNodeId("p1", "D01", "E01");
  const v2 = formulaNodeId("p1", "D01", "V2-A");
  let view = focusAgent(g, emptyExploration(), "formulator");
  view = toggleExpanded(view, v2);
  view = toggleExpanded(view, branchNodeId("p1", "formulator", "used"));
  assert.ok(visibleNodes(g, view).has(e01), "V2-A still reaches E01");
  view = toggleExpanded(view, v2);
  assert.ok(!visibleNodes(g, view).has(e01));
});

test("repeated events add no nodes and projects never share a graph", async () => {
  const store = createDemoStore();
  const { scope, state } = await study("p1", store);
  const before = buildProjectGraph(state);
  for (const event of state.log) store.apply(scope, event);
  const after = buildProjectGraph(store.get(scope));
  assert.deepEqual(Object.keys(after.nodes).sort(), Object.keys(before.nodes).sort());
  assert.equal(after.edges.length, before.edges.length);
  assert.equal(new Set(after.edges.map((e) => e.id)).size, after.edges.length);

  const other = buildProjectGraph(store.get({ ...scope, projectId: "p2" }));
  assert.equal(other.recordedHandoffs, 0);
  assert.ok(Object.keys(other.nodes).every((id) => id.startsWith("p2:")));
  assert.equal(Object.values(other.nodes).filter((n) => n.kind !== "agent").length, 0);
});

test("approved research: violet sources, the exclusion kept on the question, and V1 → SRC-02 → passage", async () => {
  const g = buildProjectGraph((await study()).state);
  const src = (id: string) => `p1:source:${id}`;
  assert.equal(g.nodes[src("SRC-01")].origin, "project");
  assert.equal(g.nodes[src("SRC-02")].origin, "project");
  assert.equal(g.nodes[src("REF-01")].origin, "baseline");
  assert.equal(g.nodes[src("H1")].origin, "hypothesis");
  const research = Object.values(g.nodes).find((n) => n.kind === "research")!;
  assert.equal(research.status, "approved");
  const toSrc01 = edge(g, research.id, src("SRC-01"));
  assert.equal(toSrc01?.decision, "excluded");
  assert.equal(edge(g, research.id, src("SRC-02"))?.decision, undefined);
  const v1 = formulaNodeId("p1", "D01", "V1");
  assert.equal(edge(g, src("SRC-02"), v1)?.verb, "ใช้กับ V1");
  assert.equal(edge(g, src("SRC-01"), v1), undefined);
  assert.ok(g.children[v1].includes(src("SRC-02")));
  const passage = g.children[src("SRC-02")].find((id) => g.nodes[id].kind === "passage");
  assert.ok(passage && g.nodes[passage].summary?.includes("ตัวอย่างจำลอง"));
  assert.ok(g.nodes[src("SRC-01")].facts.some((f) => f.label === "เหตุผลที่ไม่ใช้" && /การแพ้สัมผัส/.test(f.value)));
  assert.ok(g.nodes[src("SRC-02")].message, "returns to the request in Lab");
  // The Curator's focus shows the request already open, with what it found.
  const parents = visibleNodes(g, focusAgent(g, emptyExploration(), "researcher"));
  assert.ok(parents.has(src("SRC-01")) && parents.has(src("SRC-02")));
});

test("pending research: nothing found yet, no 'used' edge, and building the graph changes nothing", async () => {
  const { state } = await study("p1", createDemoStore(), false);
  const before = JSON.stringify(state);
  const g = buildProjectGraph(state);
  assert.equal(JSON.stringify(state), before);
  assert.equal(Object.values(g.nodes).filter((n) => n.origin === "project").length, 0);
  assert.equal(Object.values(g.nodes).find((n) => n.kind === "research")?.status, "pending");
  assert.ok(!g.edges.some((e) => e.verb.startsWith("ใช้กับ")));
});

test("receiving a handoff never makes a source 'used for V1' without a review", async () => {
  const { store, scope, state } = await study("p1", createDemoStore(), false);
  store.apply(scope, { type: "evidence.fact", fact: { kind: "used", sourceId: "REF-01", by: "analyst", versionId: "V1", reason: "x" },
    eventId: "p1:evt-used-early", sequence: 9000, projectId: "p1", experimentId: "D01", threadId: "t", source: "demo" });
  assert.equal(Object.keys(store.get(scope).facts).length, Object.keys(state.facts).length);
  assert.ok(!buildProjectGraph(store.get(scope)).edges.some((e) => e.verb.startsWith("ใช้กับ")));
});

test("an unanswered study shows only what was recorded", async () => {
  const store = createDemoStore();
  const scope: DemoScope = { userId: "guest", projectId: "p3", mode: "demo" };
  const demo = createLabDemo({ store, scope, experimentId: "D01", transport: createMockTransport(), playbook: DEMO_PLAYBOOK });
  await demo.submit("director", brief);
  await demo.idle(); // waits on the group question: only the brief has been delivered
  const g = buildProjectGraph(demo.state());
  assert.equal(g.nodes[formulaNodeId("p3", "D01", "V1")], undefined);
  assert.equal(g.nodes[evidenceNodeId("p3", "D01", "E01")], undefined);
  assert.deepEqual(g.children[branchNodeId("p3", "formulator", "received")], [agentNodeId("p3", "director")]);
});
