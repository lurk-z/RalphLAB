import type { AgentRole } from './events.ts'

// These keys also identify existing rigs and saved conversations.
export const ROLE_EN: Record<AgentRole, string> = {
  director: 'Study Lead',
  formulator: 'Formulation Chemist',
  analyst: 'Computational Toxicologist',
  researcher: 'Chemical Data Curator',
  evaluator: 'QSAR Model Scientist',
}

export const ROLE_TH: Record<AgentRole, string> = {
  director: 'หัวหน้าโครงการ',
  formulator: 'นักเคมีพัฒนาสูตร',
  analyst: 'นักพิษวิทยาเชิงคำนวณ',
  researcher: 'ผู้ดูแลข้อมูลสารเคมี',
  evaluator: 'นักวิทยาศาสตร์โมเดล QSAR',
}

export const ROLE_SCOPE: Record<AgentRole, string> = {
  director: 'อ่านใบโจทย์และแนวทางแผนการศึกษา OECD GLP กำหนดสารที่ล็อก เกณฑ์รายด้าน งบ เกณฑ์หยุด และเมื่อใดต้องขออนุมัติ บันทึกเหตุผลการตัดสินใจ',
  formulator: 'ใช้ EPA Safer Choice และเอกสารเทคนิคผู้ผลิตตรวจหน้าที่สาร ข้อจำกัด และสัดส่วนรวม 100% บันทึกสูตรรุ่นลูก สมมติฐาน และรายการเปลี่ยนแปลง สมรรถนะการทำความสะอาดต้องทดสอบแยก',
  analyst: 'อ่าน OECD IATA, NICE/ICE และ model card ของรุ่นที่รัน รายงานผล QSAR รายสารทั้งสี่ endpoint วิธีรวมผลสูตร ความเชื่อมั่น และ applicability domain พักข้อสรุปเมื่อหลักฐานไม่ตรง endpoint',
  researcher: 'ใช้ PubChem PUG REST ตรวจตัวตนสาร ตรวจ endpoint วิธีทดลอง และความหมายของ label จากหลักฐานต้นทาง ส่งรหัสสาร ผล แหล่งที่มาและข้อจำกัด บันทึก unknown เมื่อข้อมูลไม่พอ',
  evaluator: 'รับงานเมื่อพบข้อจำกัดเชิงระบบซ้ำ ตรวจตาม OECD QSAR Assessment Framework และรายงาน validation ของ RalphGuard ตรวจคลาส สารซ้ำ และผลบนชุดกันไว้ ส่งรายงาน candidate เทียบรุ่นใช้งาน การนำขึ้นใช้ต้องตัดสินใจแยก',
}
