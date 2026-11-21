export { ROLE_TH as ROLE_LABEL } from '@/lib/lab-demo/roles'
import type { AgentRole } from '@/lib/lab-demo/events'

export const roleGuide = {
  director: { task: 'วางแผนโครงการ', question: 'ควรเริ่มวางแผนประเมินสูตรอย่างไร?' },
  formulator: { task: 'ดูสัดส่วนสูตร', question: 'ต้องเตรียมข้อมูลอะไรบ้างก่อนให้ช่วยดูสูตร?' },
  analyst: { task: 'อ่านผลประเมิน', question: 'ควรอ่านผลประเมินทั้งสี่ด้านอย่างไร?' },
  researcher: { task: 'ค้นข้อมูลสาร', question: 'จะตรวจสอบชื่อสารและแหล่งข้อมูลได้อย่างไร?' },
  evaluator: { task: 'ตรวจความน่าเชื่อถือของโมเดล', question: 'จะดูได้อย่างไรว่าโมเดลเหมาะกับสารที่เลือก?' },
} satisfies Record<AgentRole, { task: string; question: string }>
