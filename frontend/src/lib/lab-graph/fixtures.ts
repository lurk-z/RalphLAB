/**
 * Demo records for the D01 graph that the Lab event stream does not carry yet.
 *
 * Every entry is keyed to a recorded handoff `stage` from `lab-demo/study-example.ts`.
 * The graph shows a fixture only after that handoff has actually been sent in the
 * project, so these records describe events; they never create one. Replace this file
 * with the backend's FormulaVersion / Evidence records when they are available.
 */

export type FormulaFixture = {
  version: string
  /** Parent version, or null for the first version of the study. */
  parent: string | null
  /** Handoff stage whose `handoff.sent` records that this version was created. */
  stage: string
  ingredients: { name: string; percent: number; role: string }[]
  change: string
  reason: string
  /** Evidence ids this version relies on. */
  evidence: string[]
  /** Formula versions whose recorded result motivated this one. */
  basedOnResultsOf: string[]
}

export type EvidenceFixture = {
  id: string
  label: string
  /** Handoff stage whose delivery records the supplier and the recipient. */
  stage: string
  endpoint: string
  subject: string
  summary: string
  record: string
  /** Recorded search query. null: the demo did not record one. */
  query: string | null
  /** Source document and the supplier's task step that records opening it. */
  document: { label: string; stepId: string; real: boolean } | null
}

export type StudyFixtures = {
  experimentId: string
  formulas: Record<string, FormulaFixture>
  evidence: Record<string, EvidenceFixture>
}

export const D01_FIXTURES: StudyFixtures = {
  experimentId: 'D01',
  formulas: {
    V1: {
      version: 'V1',
      parent: null,
      stage: 'sample-v1',
      ingredients: [
        { name: 'น้ำ', percent: 85, role: 'ตัวพา' },
        { name: 'สาร A', percent: 5, role: 'ให้ความชุ่มชื้น · ล็อกไว้' },
        { name: 'เบส B', percent: 10, role: 'ทำความสะอาด' },
      ],
      change: 'สูตรตั้งต้นของการทดลอง',
      reason: 'เปิดตามใบงานของ Study Lead · คงสาร A 5% และปรับน้ำกับเบส B ได้',
      evidence: [],
      basedOnResultsOf: [],
    },
    'V2-A': {
      version: 'V2-A',
      parent: 'V1',
      stage: 'sample-v2a',
      ingredients: [
        { name: 'น้ำ', percent: 87, role: 'ตัวพา' },
        { name: 'สาร A', percent: 5, role: 'ให้ความชุ่มชื้น · ล็อกไว้' },
        { name: 'เบส B', percent: 8, role: 'ทำความสะอาด' },
      ],
      change: 'เบส B 10% → 8% · น้ำ 85% → 87% · คงสาร A 5%',
      reason: 'ผลระคายเคืองผิวของ V1 สูงกว่าเกณฑ์จำลอง และ E01 เป็นหลักฐานด้านผิวของเบส B',
      evidence: ['E01'],
      basedOnResultsOf: ['V1'],
    },
  },
  evidence: {
    E01: {
      id: 'E01',
      label: 'E01 · เบส B',
      stage: 'revise',
      endpoint: 'การระคายเคืองผิว',
      subject: 'เบส B',
      summary: 'ใช้ประกอบการปรับสัดส่วนเบส B',
      record: 'ระเบียนจำลองของเบส B ด้านระคายเคืองผิว',
      query: null,
      document: { label: 'บันทึกระเบียน E01', stepId: 'record', real: false },
    },
  },
}
