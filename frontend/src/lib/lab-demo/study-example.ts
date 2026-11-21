import type { AgentRole } from './events.ts'
import { demoAssessment, type ChatAssessment } from './chat-assessment.ts'

export type Version = 'V1' | 'V2-A'
export const BRIEF = 'D01 · ลดข้อกังวลด้านการระคายเคืองของสูตรทำความสะอาด คงสาร A 5% งบเพิ่มสองรุ่น เดโมนี้ให้ดำเนินการในขอบเขต หากต้องแก้สารที่ล็อกให้หยุดถามผู้ใช้'
/** The D01 brief a user sends to the Study Lead (also sent by the Lab demo entry). */
export const STUDY_BRIEF = 'เปิดโครงการลดข้อกังวลด้านการระคายเคืองของสูตรทำความสะอาด'
export const DECISION = 'V2-A ผ่านเกณฑ์ผิวจำลอง แต่หลักฐานแพ้สัมผัสและพิษเฉียบพลันยังไม่พอ พักเพื่อทดสอบเพิ่มเติม เหลืองบหนึ่งรุ่น หากแยก V2-B ให้เริ่มจาก V1'
export const RESULTS: Record<Version, ChatAssessment> = {
  V1: demoAssessment,
  'V2-A': { ...demoAssessment, formulaName: 'V2-A', rows: demoAssessment.rows.map((row,i) =>
    ({ ...row, score: row.score === null ? null : Math.round(row.score * 8 / 10),
      finding: i === 0 ? 'เบส B · ต่ำกว่าเกณฑ์เดโม · อยู่ใน domain · ความเชื่อมั่นปานกลาง' : row.finding })) },
}

type Delivery = { id: string; from: AgentRole; to: AgentRole; title: string; note: string; version?: Version; item?: 'sample' | 'report'; releasesResults?: boolean }
// Scripted D01 case. Both the chat and the room replay this same sequence.
export const HANDOFFS: Delivery[] = [
  {id: "brief", from: "director", to: "formulator", title: "เปิดใบงานสูตรตั้งต้น", note: "คงสาร A 5% ปรับน้ำกับเบส B ได้ เกณฑ์ผิวจำลองต่ำกว่า 50/100 งบเพิ่มสองรุ่น"},
  {id: "sample-v1", from: "formulator", to: "analyst", title: "ส่งขวด D01-V1", note: "น้ำ 85% (ตัวพา) · สาร A 5% (ให้ความชุ่มชื้น) · เบส B 10% (ทำความสะอาด) รวม 100%", version: "V1", item: "sample"},
  {id: "evidence", from: "analyst", to: "researcher", title: "ตรวจหลักฐานด้านผิวของเบส B", note: "ผลผิวเกินเกณฑ์ เอกสารที่แนบเป็นผลแพ้สัมผัส ขอหลักฐานด้านระคายเคืองผิวโดยตรง", version: "V1", item: "report", releasesResults: true},
  {id: "revise", from: "researcher", to: "formulator", title: "ส่งหลักฐานด้านผิวเพื่อเสนอ V2-A", note: "E01 เป็นระเบียนจำลองของเบส B ด้านระคายเคืองผิว ตรงกับ endpoint ที่ต้องแก้ ส่วนข้อมูลแพ้สัมผัสยังเป็น unknown", version: "V1"},
  {id: "sample-v2a", from: "formulator", to: "analyst", title: "ส่งขวด D01-V2-A", note: "จาก V1 ลดเบส B เป็น 8% เพื่อทดสอบข้อกังวลด้านผิว เพิ่มน้ำเป็น 87% และคงสาร A 5% รวม 100%", version: "V2-A", item: "sample"},
  {id: "model-review", from: "analyst", to: "evaluator", title: "เปิดใบงานโมเดล M01", note: "เคสจำลอง D00 และ D01 พบสารนอก domain ด้านพิษเฉียบพลันซ้ำ เปิดงานทบทวนโมเดลแยกจากการแก้สูตร", version: "V2-A", item: "report", releasesResults: true},
  {id: "decision", from: "evaluator", to: "director", title: "ส่งรายงานข้อจำกัดของรุ่นใช้งาน", note: "M01 ต้องเปรียบเทียบ candidate บนชุดกันไว้ ผลพิษเฉียบพลันยังสรุปไม่ได้ การนำโมเดลขึ้นใช้งานต้องพิจารณาแยก", version: "V2-A", item: "report"},
]
