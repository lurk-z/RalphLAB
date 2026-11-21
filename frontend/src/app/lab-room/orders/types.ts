import type {
  ComparisonReport,
  ComparisonPhase,
} from "@/components/three/skincare-lab/proteinDesk/ComparisonEvidence";

export type Project = { id: number; name: string; owner: boolean };
export type Revision = {
  version: string;
  ingredients: { name: string; percent: string }[];
};
export type Action = "approve" | "reject" | "recheck";
export type Event = {
  id: string;
  sequence: number;
  at: string;
  sender: string;
  recipient: string;
  message: string;
  version: string;
  actor?: string;
  command?: { action: Action };
  tool?: [string, string];
  application?: string;
  citations?: {
    ingredient: string;
    record: number;
    pubchem?: string;
    evidence?: {
      id: number;
      source: string;
      review: string;
      reference?: string;
      url?: string;
    }[];
  }[];
  changes?: { name: string; before: string; after: string; locked: boolean }[];
  gaps?: string[];
  locked_changes?: string[];
  structures?: { name: string; structure: string }[];
};
export type Order = {
  id: string;
  project_id: number;
  state: string;
  created_at: string;
  events: Event[];
  report?: {
    decision: string;
    actor: string;
    at: string;
    note: string;
    baseline: string;
    candidate: string;
    citations: unknown[];
    changes: unknown[];
    open_questions: string[];
  } | null;
  request: {
    brief: string;
    baseline: Revision;
    candidate: Revision;
    locked: string[];
    endpoint: string;
  };
};
export type PendingOrder = Omit<Order, "state" | "request"> & {
  state: "awaiting_inputs";
  request: { brief: string; endpoint: string };
};
export const disciplines = {
  synthesis: "สังเคราะห์สารหลายขั้นตอน",
  discovery: "ค้นคว้ายาและพัฒนาสูตรตำรับ",
  stability: "ติดตามความคงตัวและอายุการเก็บ",
  trace: "วิเคราะห์สารปนเปื้อนระดับร่องรอย",
  validation: "พัฒนาและตรวจสอบวิธีวิเคราะห์",
  scale_up: "ขยายขนาดและติดตามรอบนำร่อง",
};
export type Discipline = keyof typeof disciplines;
export type Source = {
  title: string;
  url: string;
  locator: string;
  principle: string;
};
export type Step = {
  id: string;
  title: string;
  role: string;
  depends_on: string[];
  source: Source;
  application: string;
  minimum_values: number;
  due: string | null;
  status: string;
};
export type StudyEvent = Omit<Event, "command"> & {
  comparison_step?: {
    run_id: string;
    phase: ComparisonPhase;
    version: string;
    sources: Source[];
  };
  comparison_report?: ComparisonReport;
  protein_step?: {
    run_id: string;
    phase: "inspect" | "adjust" | "align" | "verify";
    model: string;
    pdb: string;
    angles: number[];
    rmsd: number;
    source_url: string;
  };
  reviewed_stage?: string;
  sources_sent?: { title: string; url: string; locator: string }[];
  stage_id?: string;
  result?: {
    disposition: string;
    observed_on: string;
    evidence: string;
    finding: string;
    measurements: number[];
    unit: string | null;
    literature: (Omit<Source, "principle"> & { application: string })[];
  };
  statistics?: {
    n: number;
    mean: number;
    sd: number | null;
    unit: string;
  } | null;
  pose?: {
    model: string;
    pdb: string;
    angles: number[];
    rmsd: number;
    source_url: string;
  };
  structure?: {
    pdb: string;
    chain: string;
    url: string;
    observed_positions: number;
    application: string;
  };
};
export type Study = Omit<Order, "request" | "report" | "events"> & {
  request: {
    kind: "study";
    case_template?: "insulin-lispro-v1";
    brief: string;
    discipline: Discipline;
    version: string;
  };
  stages: Step[];
  events: StudyEvent[];
  report?: {
    decision: string;
    actor: string;
    at: string;
    note: string;
    open_questions: string[];
  } | null;
};
export type Case = Order | PendingOrder | Study;
export function isStudy(item: Case): item is Study {
  return "stages" in item;
}
export function hasVersions(item: Case): item is Order {
  return "candidate" in item.request;
}
export const states: Record<string, string> = {
  in_progress: "กำลังรวบรวมหลักฐาน",
  ready: "รอผลจากแล็บ",
  blocked: "รอขั้นก่อนหน้า",
  scheduled: "รอถึงกำหนด",
  complete: "บันทึกผลแล้ว",
  closed: "ปิดขั้นงาน",
  awaiting_inputs: "รอแนบสูตร",
  needs_evidence: "พักเพื่อรอหลักฐาน",
  awaiting_approval: "รอหัวหน้าอนุมัติ",
  approved: "อนุมัติแล้ว",
  rejected: "ไม่อนุมัติ",
};
