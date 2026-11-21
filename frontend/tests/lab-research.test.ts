import assert from "node:assert/strict";
import test from "node:test";
import { createDemoStore, createLabDemo, createMockTransport, DEMO_PLAYBOOK, type DemoPersistence } from "../src/lib/lab-demo/engine.ts";
import { currentScope, scopeKey, type DemoScope, type LabEvent } from "../src/lib/lab-demo/events.ts";
import { demoAgentStatuses } from "../src/lib/lab-demo/agent-status.ts";
import { createMockSearchAdapter, type Approver, type Scenario } from "../src/lib/lab-demo/research.ts";
import { STUDY_BRIEF } from "../src/lib/lab-demo/study-example.ts";

const owner: Approver = { id: "owner-1", label: "เจ้าของโครงการจำลอง", owner: true, simulated: true };

function memoryPersistence(): DemoPersistence & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    load: (scope) => JSON.parse(data.get(scopeKey(scope)) ?? "[]") as LabEvent[],
    save: (scope, events) => { data.set(scopeKey(scope), JSON.stringify(events)); },
    clear: (scope) => { data.delete(scopeKey(scope)); },
  };
}

function setup({ projectId = "p1", userId = "u1", persistence, store }: { projectId?: string; userId?: string; persistence?: DemoPersistence; store?: ReturnType<typeof createDemoStore> } = {}) {
  const s = store ?? createDemoStore(undefined, persistence);
  const scope: DemoScope = { userId, projectId, mode: "demo" };
  const adapter = createMockSearchAdapter();
  const demo = createLabDemo({ store: s, scope, experimentId: "D01", transport: createMockTransport(), playbook: DEMO_PLAYBOOK, search: adapter });
  return { store: s, scope, adapter, demo };
}

/** Brief → group → V1 → Curator, which stops at the research gate (or finishes locally). */
async function startRun(demo: ReturnType<typeof setup>["demo"], scenario: Scenario) {
  demo.configure(scenario);
  const { jobId } = await demo.submit("director", STUDY_BRIEF);
  await demo.idle();
  demo.decideGroup(jobId!, true);
  await demo.idle();
  return jobId!;
}

const request = (demo: ReturnType<typeof setup>["demo"]) => Object.values(demo.state().research)[0];
const projectSources = (demo: ReturnType<typeof setup>["demo"]) => Object.values(demo.state().sources).filter((s) => s.origin === "project").map((s) => s.sourceId).sort();
const facts = (demo: ReturnType<typeof setup>["demo"], kind: string) => Object.values(demo.state().facts).filter((f) => f.kind === kind);

test("A · approve: nothing is searched before the owner approves; only SRC-02 is used for V1, after review", async () => {
  const { demo, adapter } = setup();
  await startRun(demo, "needs-approval");
  const pending = request(demo);
  assert.equal(pending.status, "pending");
  assert.equal(adapter.calls.length, 0);
  assert.deepEqual(projectSources(demo), []);
  // The red 1 over the Curator opens this exact request message.
  const status = demoAgentStatuses(demo.state()).researcher;
  assert.equal(status?.kind, "question");
  assert.equal(status?.kind === "question" && status.requestId, pending.requestId);
  assert.equal(status?.kind === "question" && status.messageId, pending.messageId);
  // Other agents keep their unrelated work: V1's screening results were already delivered.
  assert.ok(demo.state().messages.some((m) => m.kind === "agent" && m.assessment?.formulaName === "V1"));

  assert.ok(demo.decideResearch(pending.requestId, "approve", owner, currentScope("p1", pending)));
  await demo.idle();
  assert.equal(adapter.calls.length, 1);
  assert.deepEqual(projectSources(demo), ["SRC-01", "SRC-02"]);
  assert.notEqual(demoAgentStatuses(demo.state()).researcher?.kind, "question");
  const used = facts(demo, "used");
  assert.deepEqual(used.map((f) => f.kind === "used" && [f.sourceId, f.versionId, f.by]), [["SRC-02", "V1", "analyst"]]);
  const reviewed = facts(demo, "reviewed")[0];
  const handed = facts(demo, "handed")[0];
  assert.ok(handed.sequence < reviewed.sequence && reviewed.sequence < used[0].sequence, "handed → reviewed → used, as separate facts");
  const excluded = facts(demo, "excluded");
  assert.deepEqual(excluded.map((f) => f.kind === "excluded" && f.sourceId), ["SRC-01"]);
  assert.match(excluded[0].kind === "excluded" ? excluded[0].reason : "", /การแพ้สัมผัส/);
  // E01 keeps its meaning: the revision with E01 still happens once there is evidence.
  assert.ok(Object.values(demo.state().handoffs).some((h) => h.stage === "revise"));
});

test("B · edit: the edited query is only previewed until approved, then sent exactly", async () => {
  const { demo, adapter } = setup();
  await startRun(demo, "needs-approval");
  const before = request(demo);
  demo.editResearchQuery(before.requestId, "base B skin irritation OECD 439");
  const edited = request(demo);
  assert.equal(edited.query, "base B skin irritation OECD 439");
  assert.equal(edited.status, "pending");
  assert.equal(adapter.calls.length, 0);
  // The old scope on screen no longer matches: it cannot approve the edited draft.
  assert.equal(demo.decideResearch(before.requestId, "approve", owner, currentScope("p1", before)), false);
  assert.equal(request(demo).status, "pending");
  assert.ok(demo.decideResearch(edited.requestId, "approve", owner, currentScope("p1", edited)));
  await demo.idle();
  assert.deepEqual(adapter.calls.map((c) => c.query), ["base B skin irritation OECD 439"]);
});

test("C · use existing data: no search, the endpoint is recorded as insufficient, and it is not asked again", async () => {
  const { demo, adapter } = setup();
  const jobId = await startRun(demo, "needs-approval");
  const pending = request(demo);
  assert.ok(demo.decideResearch(pending.requestId, "use-existing", owner, currentScope("p1", pending)));
  await demo.idle();
  assert.equal(adapter.calls.length, 0);
  assert.equal(request(demo).status, "closed");
  assert.notEqual(demoAgentStatuses(demo.state()).researcher?.kind, "question");
  const insufficient = facts(demo, "insufficient");
  assert.ok(insufficient.some((f) => f.kind === "insufficient" && f.versionId === "V1" && f.endpoint === "skin"));
  assert.equal(facts(demo, "used").length, 0);
  // No evidence, no revision built on it.
  assert.ok(!Object.values(demo.state().handoffs).some((h) => h.stage === "revise"));
  assert.equal(Object.keys(demo.state().research).length, 1);
  assert.ok(Object.values(demo.state().tasks).filter((t) => t.jobId === jobId).every((t) => t.status === "completed"));
});

test("D · existing sources suffice: no approval request, no search, V1 traces to the project's own record", async () => {
  const { demo, adapter } = setup();
  await startRun(demo, "local-enough");
  assert.equal(Object.keys(demo.state().research).length, 0);
  assert.equal(adapter.calls.length, 0);
  const used = facts(demo, "used");
  assert.deepEqual(used.map((f) => f.kind === "used" && f.sourceId), ["REF-02"]);
  assert.equal(demo.state().sources["REF-02"].origin, "baseline");
});

test("E · a failed search is recoverable; the retry keeps one copy of each source", async () => {
  const { demo, adapter } = setup();
  await startRun(demo, "search-fails-once");
  const pending = request(demo);
  demo.decideResearch(pending.requestId, "approve", owner, currentScope("p1", pending));
  await demo.idle();
  assert.equal(request(demo).status, "failed");
  assert.equal(adapter.calls.length, 1);
  assert.deepEqual(projectSources(demo), []);
  assert.equal(facts(demo, "insufficient").length, 0, "a transport failure is not a scientific outcome");
  demo.retryResearch(pending.requestId);
  demo.retryResearch(pending.requestId);
  await demo.idle();
  assert.equal(adapter.calls.length, 2);
  assert.equal(request(demo).status, "completed");
  assert.deepEqual(projectSources(demo), ["SRC-01", "SRC-02"]);
  assert.equal(facts(demo, "used").length, 1);
});

test("E · a genuine empty result takes the no-evidence path", async () => {
  const { demo, adapter } = setup();
  await startRun(demo, "search-empty");
  const pending = request(demo);
  demo.decideResearch(pending.requestId, "approve", owner, currentScope("p1", pending));
  await demo.idle();
  assert.equal(adapter.calls.length, 1);
  assert.equal(request(demo).outcome, "no-evidence");
  assert.ok(facts(demo, "insufficient").length >= 1);
  assert.equal(facts(demo, "used").length, 0);
});

test("F · refresh while pending: the history restores without a new search, message or approval", async () => {
  const persistence = memoryPersistence();
  const first = setup({ persistence });
  await startRun(first.demo, "needs-approval");
  const before = first.demo.state();
  first.demo.dispose();

  const reloaded = setup({ persistence });
  reloaded.demo.resume();
  await reloaded.demo.idle();
  const after = reloaded.demo.state();
  assert.equal(after.log.length, before.log.length);
  assert.equal(after.messages.length, before.messages.length);
  assert.equal(request(reloaded.demo).status, "pending");
  assert.equal(reloaded.adapter.calls.length, 0);
  const status = demoAgentStatuses(after).researcher;
  assert.equal(status?.kind === "question" && status.requestId, request(reloaded.demo).requestId);

  // A double click and a replayed decision still make one approval and one search.
  const pending = request(reloaded.demo);
  const shown = currentScope("p1", pending);
  assert.ok(reloaded.demo.decideResearch(pending.requestId, "approve", owner, shown));
  assert.equal(reloaded.demo.decideResearch(pending.requestId, "approve", owner, shown), false);
  await reloaded.demo.idle();
  const decided = reloaded.demo.state().log.filter((e) => e.type === "research.decided");
  assert.equal(decided.length, 1);
  reloaded.store.apply(reloaded.scope, decided[0]);
  const edges = Object.keys(reloaded.demo.state().facts).sort();
  assert.equal(reloaded.adapter.calls.length, 1);

  // A message number restored from the history is never reused.
  const ids = reloaded.demo.state().messages.map((m) => m.messageId);
  assert.equal(new Set(ids).size, ids.length);

  // Refresh after completion: resuming starts nothing, and facts stay the same.
  reloaded.demo.dispose();
  const third = setup({ persistence });
  third.demo.resume();
  await third.demo.idle();
  assert.equal(third.adapter.calls.length, 0);
  assert.deepEqual(Object.keys(third.demo.state().facts).sort(), edges);
  assert.equal(third.demo.state().log.filter((e) => e.type === "research.search_started").length, 1);
});

test("F · an approval for another scope, a non-owner, or another project never applies", async () => {
  const persistence = memoryPersistence();
  const { demo, store, scope } = setup({ persistence });
  await startRun(demo, "needs-approval");
  const pending = request(demo);
  assert.equal(demo.decideResearch(pending.requestId, "approve", { ...owner, owner: false }, currentScope("p1", pending)), false);
  // A stale decision for a wider limit is ignored by the reducer itself.
  store.apply(scope, { type: "research.decided", requestId: pending.requestId, decision: "approve", approver: owner,
    scope: { ...currentScope("p1", pending), limit: 10 }, eventId: "p1:evt-stale", sequence: 9999, projectId: "p1",
    experimentId: "D01", threadId: pending.threadId, source: "demo" });
  assert.equal(request(demo).status, "pending");

  // Other users and projects start empty and keep their own history.
  const otherUser = setup({ persistence, userId: "u2" });
  const otherProject = setup({ persistence, projectId: "p2" });
  assert.equal(otherUser.demo.state().log.length, 0);
  assert.equal(otherProject.demo.state().log.length, 0);
  assert.equal(persistence.data.size, 1);
});

test("a reset run stops the old engine's late work and starts clean", async () => {
  const { demo, store, scope } = setup();
  await startRun(demo, "needs-approval");
  demo.dispose();
  store.reset(scope);
  const pending = Object.values(store.get(scope).research);
  assert.equal(pending.length, 0);
  assert.equal(store.get(scope).log.length, 0);
  const fresh = setup({ store });
  await startRun(fresh.demo, "local-enough");
  assert.equal(fresh.demo.state().scenario, "local-enough");
});
