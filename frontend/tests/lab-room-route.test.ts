import assert from "node:assert/strict";
import test from "node:test";
import { contextKey, loginRedirect, parseRoomQuery, roomHref, withView } from "../src/lib/lab-room/route.ts";

const state = (q: Record<string, string>) => {
  const parsed = parseRoomQuery(q);
  assert.ok(parsed.state, `expected a room state for ${JSON.stringify(q)}, got ${parsed.redirect}`);
  return parsed.state;
};

test("bare /lab-room is the room itself, not a redirect to Studio", () => {
  // Before the integration, a bare /lab-room redirected to /assess?tab=lab.
  const parsed = parseRoomQuery({});
  assert.equal(parsed.redirect, undefined);
  assert.deepEqual(parsed.state, { view: "room", context: { kind: "none" }, agent: null, tool: null });
  assert.equal(roomHref(parsed.state!), "/lab-room");
});

test("view and focus round-trip through the URL", () => {
  const s = state({ view: "graph", agent: "researcher", demo: "D01" });
  assert.equal(s.view, "graph");
  assert.equal(s.agent, "researcher");
  assert.deepEqual(s.context, { kind: "demo", study: "D01", projectId: null });
  assert.equal(roomHref(s), "/lab-room?view=graph&demo=D01&agent=researcher");
  assert.deepEqual(state(Object.fromEntries(new URL("http://x" + roomHref(s)).searchParams)), s);
});

test("switching views keeps the context, tool and focus", () => {
  const s = state({ project: "12", order: "0f8fad5b-d9cb-469f-a165-70867728950e", table: "protein" });
  const graph = withView(s, "graph", "analyst");
  assert.equal(roomHref(graph), "/lab-room?view=graph&project=12&order=0f8fad5b-d9cb-469f-a165-70867728950e&table=protein&agent=analyst");
  assert.equal(roomHref(withView(graph, "room")), "/lab-room?project=12&order=0f8fad5b-d9cb-469f-a165-70867728950e&table=protein&agent=analyst");
});

test("every context is explicit; an invalid id is never replaced by another study", () => {
  assert.deepEqual(state({ projectId: "12" }).context, { kind: "project", projectId: 12 });
  assert.deepEqual(state({ project: "12" }).context, { kind: "project", projectId: 12 });
  assert.deepEqual(state({ demo: "d01", projectId: "12" }).context, { kind: "demo", study: "D01", projectId: 12 });
  assert.deepEqual(state({ study: "demo-color-change" }).context, { kind: "timed", studyId: "demo-color-change", fixture: true });
  assert.deepEqual(state({ project: "12", order: "not-a-uuid" }).context, { kind: "invalid", param: "order", value: "not-a-uuid" });
  assert.deepEqual(state({ projectId: "-1" }).context, { kind: "invalid", param: "projectId", value: "-1" });
  assert.deepEqual(state({ study: "../x" }).context, { kind: "invalid", param: "study", value: "../x" });
  assert.deepEqual(state({ demo: "D99" }).context, { kind: "invalid", param: "demo", value: "D99" });
  assert.equal(state({ agent: "admin" }).agent, null);
});

test("Studio Lab/Graph bookmarks move into the room; Assessment stays in Studio", () => {
  assert.deepEqual(parseRoomQuery({ tab: "lab", projectId: "12" }), { redirect: "/lab-room?projectId=12" });
  assert.deepEqual(parseRoomQuery({ tab: "nodes", projectId: "12", agent: "formulator" }), { redirect: "/lab-room?view=graph&projectId=12&agent=formulator" });
  assert.deepEqual(parseRoomQuery({ tab: "graph" }), { redirect: "/lab-room?view=graph" });
  assert.deepEqual(parseRoomQuery({ tab: "assess", projectId: "12" }), { redirect: "/assess?tab=assess&projectId=12" });
  // The station link and the protein launcher still open their tools in the room.
  assert.equal(state({ table: "station" }).tool, "station");
  assert.equal(state({ table: "protein" }).tool, "protein");
});

test("the login callback returns to the same room state and nothing else", () => {
  const s = state({ view: "graph", project: "7", order: "0f8fad5b-d9cb-469f-a165-70867728950e", agent: "analyst" });
  assert.equal(loginRedirect(s), "/login?callbackUrl=" + encodeURIComponent("/lab-room?view=graph&project=7&order=0f8fad5b-d9cb-469f-a165-70867728950e&agent=analyst"));
  assert.ok(decodeURIComponent(loginRedirect(state({ demo: "https://evil.example" }))).includes("/lab-room?demo="));
});

test("reads and memory are keyed by viewer and the exact work context", () => {
  const a = contextKey("u1", { kind: "order", projectId: 12, orderId: "a" });
  const b = contextKey("u1", { kind: "order", projectId: 12, orderId: "b" });
  const other = contextKey("u2", { kind: "order", projectId: 12, orderId: "a" });
  assert.notEqual(a, b);
  assert.notEqual(a, other);
});
