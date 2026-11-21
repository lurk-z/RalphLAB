import type {Role} from "../agents/workflow"
const prompts:Record<Role,string[]>={
  director:["แสดงสถานะใบงานของโปรเจกต์","ประเมิน QSAR ใบหน้า น้ำ 95% กลีเซอริน 5%","ค้นงานวิจัยเรื่องความคงตัวของสูตรและบอกว่าแต่ละแหล่งช่วยตอบอะไร"],
  researcher:["ค้นงานวิจัยเรื่องความคงตัวของสูตร พร้อมแหล่งอ้างอิง","เปรียบเทียบโครงสร้างอ้างอิงอินซูลินกับ lispro"],
  analyst:["อ่านผล QSAR ล่าสุด","แสดงงานติดตามตามเวลาของโปรเจกต์"],
  formulator:["ช่วยดูหลักฐานเรื่องความคงตัวของสูตร","แสดงใบงานพัฒนาสูตรของโปรเจกต์"],
  evaluator:["ตรวจแหล่งอ้างอิงที่ใช้ประเมินการระคายเคือง","อ่านผล QSAR ล่าสุด"],
}
export default function LabChatPrompts({role,choose}:{role:Role;choose:(text:string)=>void}){
  return <div className="grid gap-2 p-2">{prompts[role].map(text=><button type="button" key={text}
    className="rounded-xl border border-teal-200 px-3 py-2 text-left text-sm text-teal-900 hover:bg-teal-50" onClick={()=>choose(text)}>{text}</button>)}</div>
}
