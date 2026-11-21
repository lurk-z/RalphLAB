export type AssessmentRow = { label: string; score: number | null; finding: string }

/** A snapshot taken when the message was sent, independent of later formula edits. */
export type ChatAssessment = {
  source: 'demo' | 'assessment'
  formulaName: string
  recordId: string
  rows: AssessmentRow[]
  method?: string
  view?: 'table' | 'chart'
}

export const demoAssessment: ChatAssessment = {
  source: 'demo', formulaName: 'V1', recordId: 'D01',
  method: 'D01 · demo-1 · คะแนนตั้งต้นจำลองของสาร B คือ ผิว 58 ตา 24 ส่วนแพ้สัมผัสและพิษเฉียบพลันเป็น unknown ตัวเลขในตารางคือดัชนีสูตรสำหรับเดโม คำนวณจากคะแนนตั้งต้น × (%B ในสูตร / 10%) แล้วปัดเป็นจำนวนเต็ม',
  rows: [
    { label: 'ระคายเคืองผิว', score: 58, finding: 'เบส B · สูงกว่าเกณฑ์เดโม · อยู่ใน domain · ความเชื่อมั่นปานกลาง' },
    { label: 'ระคายเคืองตา', score: 24, finding: 'เบส B · ต่ำ · อยู่ใน domain · ความเชื่อมั่นต่ำ' },
    { label: 'แพ้สัมผัส', score: null, finding: 'เบส B · ขาดหลักฐานตรง endpoint · ยังระบุความเชื่อมั่นและ domain ไม่ได้' },
    { label: 'พิษเฉียบพลัน', score: null, finding: 'เบส B · นอก domain · พักข้อสรุป' },
  ],
}

export function assessmentViewRequested(question: string) {
  return /(?:ดู|สรุป)ผล|ผล(?:การ)?(?:คัดกรอง|ประเมิน|ทดลอง|เป็น)|คัดกรอง|endpoint|สี่ด้าน|4\s*ด้าน|กราฟ|ตาราง|chart|graph|table|screening|assessment/i.test(question)
}

export function requestedView(question: string): 'chart' | 'table' {
  return /กราฟ|chart|graph/i.test(question) ? 'chart' : 'table'
}

export function assessmentText(data: ChatAssessment) {
  const source = data.source === 'demo' ? 'ข้อมูลจำลอง' : 'ผลคัดกรองจาก Assessment'
  return [`${source} · ${data.formulaName} · ${data.recordId}`, ...(data.method ? [data.method] : []), ...data.rows.map(row =>
    `${row.label}: ${row.score === null ? 'ไม่มีคะแนน' : row.score + '/100'} · ${row.finding}`)].join('\n')
}

export function isChatAssessment(value: unknown): value is ChatAssessment {
  if (!value || typeof value !== 'object') return false
  const data = value as Partial<ChatAssessment>
  return (data.source === 'demo' || data.source === 'assessment') && typeof data.formulaName === 'string' &&
    typeof data.recordId === 'string' && (data.method === undefined || typeof data.method === 'string') && Array.isArray(data.rows) && data.rows.length === 4 &&
    data.rows.every(row => row && typeof row.label === 'string' && typeof row.finding === 'string' &&
      (row.score === null || (Number.isFinite(row.score) && row.score >= 0 && row.score <= 100)))
}
