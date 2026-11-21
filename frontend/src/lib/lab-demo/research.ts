/**
 * Approval-gated research for the D01 demo · domain types, demo scenarios and the mock
 * search adapter.
 *
 * Agents may read their role references and the sources already in the project at any time.
 * Searching outside the project needs the project owner's approval for one question and one
 * displayed scope. Everything here is simulated (“ข้อมูลจำลอง”): no network search is made.
 */
import type { AgentRole } from "./events.ts";

/** Demo configurations a reviewer can pick before starting a run. */
export type Scenario = "needs-approval" | "local-enough" | "search-fails-once" | "search-empty";

export const SCENARIOS: { id: Scenario; label: string; hint: string }[] = [
  { id: "needs-approval", label: "ต้องขออนุมัติค้นเพิ่ม", hint: "แหล่งในโครงการไม่ตรงประเด็น ผู้ดูแลข้อมูลจะขอค้นเอกสารเพิ่ม" },
  { id: "local-enough", label: "แหล่งในโครงการเพียงพอ", hint: "มีหลักฐานด้านผิวในโครงการแล้ว ไม่ต้องขอค้น" },
  { id: "search-fails-once", label: "ค้นล้มเหลวครั้งแรก", hint: "การค้นครั้งแรกเชื่อมต่อไม่ได้ ลองใหม่ด้วยขอบเขตเดิม" },
  { id: "search-empty", label: "ค้นแล้วไม่พบหลักฐาน", hint: "ค้นสำเร็จแต่ไม่มีเอกสารที่ใช้ได้" },
];
export const DEFAULT_SCENARIO: Scenario = "needs-approval";

export type SourceOrigin = "baseline" | "project" | "hypothesis";
export type Endpoint = "skin" | "sens" | "identity" | "method" | "hypothesis";

export const ENDPOINT_TH: Record<Endpoint, string> = {
  skin: "ระคายเคืองผิว",
  sens: "การแพ้สัมผัส",
  identity: "ตัวตนสาร",
  method: "วิธีทำงานของบทบาท",
  hypothesis: "สมมติฐาน",
};

export type SourceRecord = {
  sourceId: string;
  title: string;
  /** What the document is about; one document can answer one question and not another. */
  endpoint: Endpoint;
  origin: SourceOrigin;
  /** baseline: available before the run · project: discovered during this project's run. */
  publisher: string;
  /** Example passage (simulated) that an agent may record. */
  passage?: string;
  /** Who already holds a baseline item (for the graph). */
  heldBy?: AgentRole;
  /** Discovery for project sources. */
  foundBy?: AgentRole;
  requestId?: string;
  demo: true;
};

/** The project question that needs evidence: one ingredient, one endpoint, one formula version. */
export type ResearchQuestion = { ingredient: string; endpoint: Endpoint; versionId: string };

/** What the owner approves. Anything outside it needs a new approval. */
export type ResearchScope = {
  projectId: string;
  requestId: string;
  ingredient: string;
  endpoint: Endpoint;
  versionId: string;
  limit: number;
  query: string;
};

export type Approver = { id: string; label: string; owner: boolean; simulated: boolean };

export const SEARCH_LIMIT = 3;

/** The outbound query names only the ingredient and the endpoint. */
export function draftQuery(question: Pick<ResearchQuestion, "ingredient" | "endpoint">) {
  return `${question.ingredient} ${question.endpoint === "skin" ? "skin irritation" : ENDPOINT_TH[question.endpoint]}`;
}

export function scopeKeyOf(scope: ResearchScope) {
  return [scope.projectId, scope.requestId, scope.ingredient, scope.endpoint, scope.versionId, scope.limit, scope.query].join("|");
}

/** Sources every D01 run starts with. `local-enough` also holds a skin-irritation record. */
export function baselineSources(scenario: Scenario): SourceRecord[] {
  const base: SourceRecord[] = [
    { sourceId: "BASE-PUBCHEM", title: "PubChem", endpoint: "identity", origin: "baseline", publisher: "PubChem PUG REST (ระเบียนตัวอย่าง)", heldBy: "researcher", demo: true,
      passage: "ใช้ยืนยันชื่อและโครงสร้างของเบส B เท่านั้น ไม่มีผลทดสอบการระคายเคืองผิว" },
    { sourceId: "BASE-GUIDE", title: "คู่มือประจำบทบาท", endpoint: "method", origin: "baseline", publisher: "คลังความรู้ทีม RalphLab", heldBy: "researcher", demo: true,
      passage: "ให้ตรวจ endpoint และวิธีทดลองของหลักฐานก่อนส่งต่อ บันทึก unknown เมื่อหลักฐานไม่ตรงประเด็น" },
    { sourceId: "REF-01", title: "การแพ้สัมผัส · เบส B", endpoint: "sens", origin: "baseline", publisher: "เอกสารแนบของโครงการ D01", heldBy: "analyst", demo: true,
      passage: "รายงานผลการแพ้สัมผัส (skin sensitisation) ของเบส B ไม่ได้รายงานการระคายเคืองผิว" },
    { sourceId: "H1", title: "สมมติฐาน H1", endpoint: "hypothesis", origin: "hypothesis", publisher: "Computational Toxicologist", heldBy: "analyst", demo: true,
      passage: "เบส B น่าจะเป็นสาเหตุหลักของคะแนนระคายเคืองผิวที่สูงใน V1 ต้องมีหลักฐานด้านผิวมายืนยัน" },
  ];
  if (scenario === "local-enough") base.push({
    sourceId: "REF-02", title: "ระคายเคืองผิว · เบส B", endpoint: "skin", origin: "baseline", publisher: "เอกสารแนบของโครงการ D01", heldBy: "researcher", demo: true,
    passage: "ตัวอย่างจำลอง: ทดสอบเบส B 10% บนแบบจำลองผิวตามแนว OECD TG 439 พบความมีชีวิตของเซลล์ลดลงต่ำกว่าเกณฑ์ จัดว่าระคายเคืองผิว",
  });
  return base;
}

/** Illustrative public documents the mock search returns. */
export const SEARCH_RESULTS: SourceRecord[] = [
  { sourceId: "SRC-01", title: "การแพ้สัมผัส", endpoint: "sens", origin: "project", publisher: "เอกสารสาธารณะ (ตัวอย่างจำลอง)", demo: true,
    passage: "ตัวอย่างจำลอง: ผล LLNA ของเบส B ไม่พบการกระตุ้นการแพ้ที่ความเข้มข้นที่ทดสอบ" },
  { sourceId: "SRC-02", title: "ระคายเคืองผิว", endpoint: "skin", origin: "project", publisher: "เอกสารสาธารณะ (ตัวอย่างจำลอง)", demo: true,
    passage: "ตัวอย่างจำลอง: สารละลายเบส B 10% บนแบบจำลองผิวมนุษย์ (OECD TG 439) ทำให้ความมีชีวิตของเซลล์เหลือ 42% ต่ำกว่าเกณฑ์ 50% จัดเป็นสารระคายเคืองผิว" },
];

// ---------------------------------------------------------------- mock search adapter

export type SearchRequest = { projectId: string; requestId: string; attempt: number; query: string; limit: number; scenario: Scenario };
export type SearchCall = SearchRequest & { outcome: "results" | "empty" | "failed"; at: number };

export class SearchError extends Error {
  readonly reason: "unreachable" | "interrupted";
  constructor(reason: "unreachable" | "interrupted") {
    super(`search failed: ${reason}`);
    this.reason = reason;
  }
}

export interface SearchAdapter {
  search(request: SearchRequest): Promise<SourceRecord[]>;
}

/**
 * Deterministic stand-in for an external document search. It never touches the network; each
 * invocation is recorded so tests and the demo can show whether a search started.
 */
export function createMockSearchAdapter({ latencyMs = 0 }: { latencyMs?: number } = {}) {
  const calls: SearchCall[] = [];
  const listeners = new Set<() => void>();
  const adapter: SearchAdapter & { calls: SearchCall[]; subscribe: (fn: () => void) => () => void } = {
    async search(request) {
      const outcome: SearchCall["outcome"] = request.scenario === "search-fails-once" && request.attempt === 1 ? "failed"
        : request.scenario === "search-empty" ? "empty" : "results";
      calls.push({ ...request, outcome, at: Date.now() });
      listeners.forEach((fn) => fn());
      if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs));
      if (outcome === "failed") throw new SearchError("unreachable");
      return outcome === "empty" ? [] : SEARCH_RESULTS.slice(0, request.limit).map((s) => ({ ...s }));
    },
    calls,
    subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
  };
  return adapter;
}
