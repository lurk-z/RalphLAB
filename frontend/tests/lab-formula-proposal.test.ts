import assert from "node:assert/strict";
import test from "node:test";
import { isWaterItem, withWaterBase } from "../src/lib/catalog.ts";
import { createChatArchive } from "../src/lib/lab-demo/chat-history.ts";
import { createDemoStore, createLabDemo, createMockTransport, type DemoPersistence } from "../src/lib/lab-demo/engine.ts";
import type { DemoScope } from "../src/lib/lab-demo/events.ts";
import { readFormulaProposal } from "../src/lib/lab-demo/formula-proposal.ts";

const name = "โทนเนอร์เพิ่มความชุ่มชื้น";
const water = { name: "Water (Aqua)", concentration: 94.95 };
const glycerin = { name: "Glycerol", concentration: 5 };
const panthenol = { name: "Panthenol", concentration: 0.05, smiles: "wrong model value" };

test("accepts all percentages and resolves known ingredient structures", () => {
  assert.deepEqual(readFormulaProposal({ name, items: [water, glycerin, panthenol] }), {
    name,
    items: [
      { ...water, smiles: "O" },
      { ...glycerin, smiles: "OCC(O)CO" },
      { ...panthenol, smiles: "OCC(C)(C)C(O)C(=O)NCCCO" },
    ],
  });
});

test("accepts a complete water-free proposal with an explicitly supplied structure", () => {
  const item = { name: "Capric Acid", smiles: "CCCCCCCCCC(=O)O", concentration: 100 };
  assert.deepEqual(readFormulaProposal({ name, items: [item] }), { name, items: [item] });
});

test("keeps named ingredients without a structure in the formula box", () => {
  const roseWater = { name: "Rose Water", concentration: 4, smiles: "O" };
  const extract = { name: "Green Tea Extract", concentration: 1 };
  const distilled = { name: "น้ำกลั่น", concentration: 95 };
  const proposal = readFormulaProposal({ name, items: [distilled, roseWater, extract] });
  assert.ok(proposal);
  assert.deepEqual(proposal.items, [
    { ...distilled, smiles: "O" },
    { ...roseWater, smiles: "" },
    { ...extract, smiles: "" },
  ]);
  assert.deepEqual(proposal.items.map(isWaterItem), [true, false, false]);
  assert.deepEqual(withWaterBase(proposal.items).map((item) => item.concentration), [95, 4, 1]);
  assert.equal(isWaterItem({ name: "Water (floral extract)" }), false);
});

test("rejects an entire proposal if a name or percentage is missing or percentages are incomplete", () => {
  for (const items of [
    [],
    [glycerin, panthenol],
    [water, glycerin, { ...panthenol, concentration: "0.05" }],
    [water, glycerin, { ...panthenol, concentration: Number.NaN }],
    [water, glycerin, { name: "", concentration: 0.05 }],
  ]) {
    assert.equal(readFormulaProposal({ name, items }), null);
  }
});

test("keeps the demo proposal identity through a reload and allocates a new one after reset", async () => {
  const scope: DemoScope = { userId: "owner", projectId: "p1", mode: "demo" };
  const saved = new Map<string, string>();
  const storage = {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => { saved.set(key, value); },
  };
  const persistence: DemoPersistence = {
    load: () => JSON.parse(storage.getItem("events") ?? "[]"),
    save: (_scope, events) => storage.setItem("events", JSON.stringify(events)),
    clear: () => { saved.delete("events"); },
  };
  const start = (sessionId: string) => {
    const archive = createChatArchive(() => storage, sessionId);
    const store = createDemoStore(archive.append, persistence);
    const engine = createLabDemo({ scope, store, experimentId: "D01", transport: createMockTransport() });
    return { archive, store, engine };
  };

  const first = start("before-reload");
  await first.engine.submit("director", "ขอสูตรเต็ม");
  const original = first.engine.state().messages.at(-1);
  assert.ok(original?.kind === "agent" && original.proposal);
  first.engine.dispose();

  const reloaded = start("after-reload");
  assert.deepEqual(reloaded.engine.state().messages.at(-1), original);
  assert.equal(reloaded.archive.load(scope).saved[0].messages.at(-1)?.proposalMessageId, original.messageId);
  reloaded.engine.dispose();
  reloaded.store.reset(scope);
  reloaded.archive.clear(scope);

  const reset = start("after-reset");
  await reset.engine.submit("director", "ขอสูตรเต็ม");
  const replacement = reset.engine.state().messages.at(-1);
  assert.ok(replacement?.kind === "agent" && replacement.proposal);
  assert.notEqual(replacement.messageId, original.messageId);
  reset.engine.dispose();
});
