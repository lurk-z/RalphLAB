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
  citations?: {
    ingredient: string;
    record: number;
    pubchem?: string;
    evidence?: { id: number; source: string; review: string; url?: string }[];
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
  request: {
    brief: string;
    baseline: Revision;
    candidate: Revision;
    locked: string[];
    endpoint: string;
  };
};
export const states: Record<string, string> = {
  needs_evidence: "พักเพื่อรอหลักฐาน",
  awaiting_approval: "รอหัวหน้าอนุมัติ",
  approved: "อนุมัติแล้ว",
  rejected: "ไม่อนุมัติ",
};
