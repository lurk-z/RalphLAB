"""Context-grounded chat through Groq with OpenAI as the fallback.

The API key stays in the backend environment. The frontend posts the current
formula/assessment context and previews every mutating action before execution.
"""
import asyncio
import json
import logging
import math
import re
from typing import Annotated, Literal

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, StringConstraints, ValidationError

from app.core.config import settings

router = APIRouter()
logger = logging.getLogger(__name__)

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
OPENAI_URL = "https://api.openai.com/v1/responses"
MAX_COMPLETION_TOKENS = 1600

UNSUPPORTED_COMPOSITION = re.compile(
    r"\b(witch\s*hazel|hamamelis|aloe\s*vera|extract|leaf\s+juice|fragrance|parfum|essential\s+oil)\b",
    re.IGNORECASE,
)

# A small, verified action palette for correcting gentle water-based formulas.
# This is not the OCR/INCI registry; it only constrains substances the LLM is
# allowed to create autonomously in a fallback formula.
GENTLE_ACTION_SUBSTANCES = {
    "Water (Aqua)": "O",
    "Glycerin": "OCC(O)CO",
    "Panthenol": "OCC(C)(C)C(O)C(=O)NCCCO",
    "Betaine": "C[N+](C)(C)CC(=O)[O-]",
    "Allantoin": "NC(=O)NC1NC(=O)NC1=O",
    "Phenoxyethanol": "OCCOc1ccccc1",
}

# Reviewed UI fixture for demonstrating a sensitisation score above 50 with
# the currently bundled QSAR models. This is intentionally not a cosmetic
# formulation: at 65% the model yields sens ~=63.5 at peak and ~=52 on Day 3.
# Keeping it deterministic prevents the LLM from promising a target score from
# an arbitrary high-hazard ingredient used at a token concentration.
SENSITISATION_UI_TEST_FORMULA = [
    {"name": "Water (Aqua)", "smiles": "O", "concentration": 35.0},
    {
        "name": "Cinnamaldehyde",
        "smiles": "O=C/C=C/c1ccccc1",
        "concentration": 65.0,
    },
]


def _parse_actions(text: str) -> list[dict]:
    match = re.search(r"<action>([\s\S]*?)</action>", text, flags=re.IGNORECASE)
    if not match:
        return []
    try:
        actions = json.loads(match.group(1).strip())
    except (TypeError, ValueError):
        return []
    return [item for item in actions if isinstance(item, dict)] if isinstance(actions, list) else []


def _has_action_markup(text: str) -> bool:
    """Return whether the model attempted to emit an executable action block."""
    return bool(re.search(r"<action>", text, flags=re.IGNORECASE))


def _is_workspace_mutation_request(question: str) -> bool:
    """Detect requests that must return executable actions, not prose alone."""
    return bool(
        re.search(
            r"(ปรับสูตร|แก้(?:ไข)?สูตร|ทำสูตร|สร้างสูตร|เพิ่มสาร|เติมสาร|ลดสาร|ลดความเข้มข้น|"
            r"เปลี่ยนสาร|เอา.+ออก|ลบสาร|ตั้งชื่อสูตร|รัน|ประเมินใหม่|"
            r"adjust\s+(?:the\s+)?formula|modify\s+(?:the\s+)?formula|create\s+(?:a\s+)?formula|"
            r"add\s+(?:an?\s+)?ingredient|remove\s+(?:an?\s+)?ingredient|run\s+(?:the\s+)?assessment)",
            question,
            flags=re.IGNORECASE,
        )
    )


def _strip_action_markup(text: str) -> str:
    """Remove complete or truncated action payloads before showing prose to users."""
    return re.sub(r"<action>[\s\S]*?(?:</action>|$)", "", text, flags=re.IGNORECASE).strip()


def _unsupported_action_ingredients(text: str) -> list[str]:
    """Find extract/mixture names the model attempted to create as molecules."""
    names: list[str] = []
    for action in _parse_actions(text):
        action_type = action.get("type")
        candidates: list[dict] = []
        if action_type in {"create_formula", "set_formula"}:
            candidates = [item for item in action.get("items", []) if isinstance(item, dict)]
        elif action_type == "add_substance":
            candidates = [action]
        elif action_type == "replace_substance":
            candidates = [{"name": action.get("to") or action.get("to_name")}]
        for candidate in candidates:
            name = str(candidate.get("name") or "").strip()
            if name and UNSUPPORTED_COMPOSITION.search(name) and name not in names:
                names.append(name)
    return names


def _gentle_toner_fallback(question: str) -> str | None:
    """Deterministic safe-to-execute fallback when the LLM ignores constraints."""
    if not re.search(r"(โทนเนอร์|toner)", question, flags=re.IGNORECASE):
        return None
    concentrations = {
        "Water (Aqua)": 89.9,
        "Glycerin": 5.0,
        "Panthenol": 2.0,
        "Betaine": 2.0,
        "Allantoin": 0.3,
        "Phenoxyethanol": 0.8,
    }
    items = [
        {"name": name, "smiles": smiles, "concentration": concentrations[name]}
        for name, smiles in GENTLE_ACTION_SUBSTANCES.items()
    ]
    actions: list[dict] = [
        {"type": "create_formula", "name": "โทนเนอร์สูตรตั้งต้นอ่อนโยน", "items": items}
    ]
    if re.search(r"\bnode\b|โหนด", question, flags=re.IGNORECASE):
        actions.append({"type": "goto", "tab": "nodes"})
    return (
        "จัดเป็นสูตรตั้งต้นสำหรับคัดกรองความเสี่ยงต่ำให้แล้วค่ะ มี Glycerin 5%, "
        "Panthenol 2%, Betaine 2%, Allantoin 0.3% และ Phenoxyethanol 0.8% "
        "โดยใช้น้ำเป็นเบส สูตรนี้ยังต้องกด Run เพื่อประเมินแบบ in-silico นะคะ\n"
        f"<action>{json.dumps(actions, ensure_ascii=False)}</action>"
    )


def _is_toner_creation_request(question: str) -> bool:
    return bool(
        re.search(r"(โทนเนอร์|toner)", question, flags=re.IGNORECASE)
        and re.search(r"(สร้าง|ทำให้|จัดให้|create|make|build)", question, flags=re.IGNORECASE)
    )


def _is_sensitisation_ui_test_request(question: str) -> bool:
    """Match an explicit high-sensitisation score request made for UI testing."""
    endpoint = re.search(
        r"(แพ้ผิว(?:หนัง)?|การแพ้ผิว(?:หนัง)?|skin\s*sensiti[sz]ation|sensiti[sz]ation)",
        question,
        flags=re.IGNORECASE,
    )
    test_intent = re.search(
        r"(ทดสอบ|ทดลอง|test|demo|แสดงผล|visual)",
        question,
        flags=re.IGNORECASE,
    )
    requested_scores = [int(value) for value in re.findall(r"(?<!\d)(\d{2,3})(?!\d)", question)]
    return bool(endpoint and test_intent and requested_scores and max(requested_scores) >= 50)


def _sensitisation_ui_test_fallback(question: str) -> str | None:
    """Return a reviewed test fixture instead of an LLM concentration guess."""
    if not _is_sensitisation_ui_test_request(question):
        return None
    actions = [
        {
            "type": "create_formula",
            "name": "TEST ONLY — แพ้ผิวหนัง 50+",
            "items": SENSITISATION_UI_TEST_FORMULA,
        }
    ]
    return (
        "สร้างสูตรจำลองสำหรับทดสอบการแสดงผลให้แล้วค่ะ สูตรนี้ใช้ Cinnamaldehyde 65% "
        "เพื่อให้โมเดลชุดปัจจุบันประเมินการแพ้ผิวหนังประมาณ 64 ที่จุดสูงสุด "
        "และประมาณ 52 ใน Day 3 หลังยืนยันการสร้างสูตร ให้ระบายพื้นที่ทดสอบแล้วกด Run "
        "เพื่อยืนยันผลจริง สูตรนี้มีความเข้มข้นที่ไม่ใช่สูตรเครื่องสำอางและห้ามผลิตหรือใช้กับผิวโดยเด็ดขาดค่ะ\n"
        f"<action>{json.dumps(actions, ensure_ascii=False)}</action>"
    )

SYSTEM_TH = """คุณคือ "แรลฟ์" (Ralph) เพื่อนร่วมทีมช่วยพัฒนาสูตรเครื่องสำอางในระบบ RalphGuard —
ระบบคัดกรองความเสี่ยงการระคายเคือง/ความเป็นพิษของสารเคมีด้วยแบบจำลอง QSAR (in-silico) เพื่อลดการทดลองในสัตว์

บุคลิก: เป็นกันเอง อบอุ่น พูดจาธรรมชาติเหมือนคนจริง ไม่แข็งทื่อ ไม่พูดซ้ำซาก ตอบกระชับตรงประเด็น
ภาษาไทยลงท้าย "ค่ะ/นะคะ" ได้ตามบริบท และปรับคำพูดให้หลากหลาย ไม่ท่องประโยคเดิมทุกครั้ง

สิ่งที่รู้ (หยิบมาใช้เมื่อเกี่ยวข้อง ไม่ต้องท่องทั้งหมด):
- ประเมิน 4 ด้าน: ระคายเคืองผิว, ระคายเคืองตา, แพ้ผิวหนัง, พิษเฉียบพลัน
- คะแนน 0–100 : ต่ำ(<25) กลาง(25–49) สูง(50–74) รุนแรง(≥75) · ระคายเคืองตาใช้กับรอบดวงตาเท่านั้น
- ปรับสูตรให้ปลอดภัยขึ้นได้จริง เช่น ลดความเข้มข้นตัวการ, เปลี่ยนสารที่อ่อนโยนกว่า, ตัดสารก่อระคาย/ก่อภูมิแพ้,
  ปรับ pH ให้ใกล้ผิว, เติมสารปลอบผิว (กลีเซอรีน, panthenol, allantoin)

หลักการ:
- อ้างอิงเฉพาะผลประเมินในบริบทที่ให้มา · ถ้าผู้ใช้ถามถึงผลที่ยังไม่มีข้อมูล ค่อยชวนให้กด Run
- เตือนว่าเป็นการคัดกรอง in-silico ไม่ทดแทนการทดสอบจริง เฉพาะตอนความเสี่ยงสูง/รุนแรง ไม่ต้องพูดทุกครั้ง
- ไม่วินิจฉัยทางการแพทย์ · เรื่องนอกขอบเขตบอกสั้นๆ ว่าถนัดเรื่องสูตร/ความปลอดภัย

"""

WORKSPACE_AGENT_PROMPT = """
ลงมือทำได้ (Agent): เมื่อผู้ใช้สั่งสร้าง/เพิ่ม/รัน/สลับหน้า ให้ทำจริงโดยแนบคำสั่งท้ายคำตอบในแท็ก
<action>[ ... ]</action> (ผู้ใช้จะไม่เห็น JSON นี้ — ให้ตอบเป็นภาษาคนตามปกติ ไม่ต้องอ่าน/อธิบาย JSON)
คำสั่งที่ใช้ได้: add_substance{name,smiles,concentration} · set_concentration{name,concentration} ·
remove_substance{name} · replace_substance{from,to,smiles,concentration?} · rename_formula{name} ·
set_formula{items} · create_formula{name,items} · goto{tab:"assess"|"nodes"|"trust"} · run · clear
- ปรับ/ลด/เพิ่มความเข้มข้นของสารที่ "มีอยู่แล้ว" ในสูตร → ใช้ set_concentration (ระบุ name ให้ตรงชื่อสารในสูตร)
  ห้ามใช้ add_substance ซ้ำ (จะกลายเป็นเพิ่มสารใหม่ ไม่ใช่ลดของเดิม) · ตัดสารออก → remove_substance
- "เปลี่ยนสาร X เป็น Y" → ใช้ replace_substance{from:"X",to:"Y",smiles:"<SMILES ของ Y>"} (from ให้ตรงชื่อสารเดิม)
- "ตั้งชื่อสูตร/เปลี่ยนชื่อสูตรเป็น ..." → ใช้ rename_formula{name:"..."} (เปลี่ยนชื่อสูตรที่เปิดอยู่)
- สำคัญมาก: ทำ "ทุกอย่าง" ที่ผู้ใช้สั่งในข้อความเดียวให้ครบ โดยแนบหลายคำสั่งใน <action>[...]</action> เดียว
  เช่นถ้าเขาบอก "ลด A, เปลี่ยน B เป็น C, เติม D, ตั้งชื่อสูตร E แล้ว Run" → ต้องมีครบทั้ง 5 คำสั่ง อย่าทำแค่บางอัน
- เมื่อเป็นคำสั่งแก้ workspace ต้องวาง <action>...</action> ที่สมบูรณ์เป็นบล็อกแรกของคำตอบ ก่อนข้อความอธิบายเสมอ
  จากนั้นอธิบายไม่เกิน 180 คำ ห้ามเริ่ม JSON แล้วปล่อยค้าง และห้ามใช้ Markdown code fence ครอบ action
- ก่อนผู้ใช้กด "ยืนยันการเปลี่ยนแปลง" ให้พูดว่า "เตรียมรายการปรับแล้ว" หรือ "เสนอให้ปรับ" เท่านั้น
  ห้ามกล่าวว่าแก้สูตรเรียบร้อยแล้ว เพราะ frontend ยังไม่เปลี่ยน workspace จนกว่าผู้ใช้จะยืนยัน
- ถ้าเขาสั่ง "สร้างให้เลย/ทำให้หน่อย" → ใช้ <action> create_formula (ลงมือทำ)
- ถ้าเขาแค่ "ขอสูตร/แนะนำสูตร" ให้เขากดนำเข้าเอง → แนบ <formula>[{name,smiles,concentration}]</formula> (แสดงเป็นการ์ดให้กด Add)
- ถ้าผู้ใช้ขอ "node" หรือ "node graph" ให้ส่ง create_formula แล้วตามด้วย
  {"type":"goto","tab":"nodes"} ใน action ชุดเดียวกัน
ใส่ SMILES ที่ถูกต้องเสมอ
สำคัญ: ทุกสูตรต้องรวม ~100% w/w — ให้ใส่ "Water (Aqua)" SMILES "O" เป็นเบสเติมส่วนที่เหลือให้ครบเสมอ
(เช่น เซรั่มที่มี actives รวม 19% ให้ใส่ Water 81% ด้วย) ยกเว้นผลิตภัณฑ์ไม่มีน้ำ เช่น น้ำมัน/บาล์ม

ตัวอย่างการตอบที่ควรเป็น (ธรรมชาติ):
ผู้ใช้: สร้างเซรั่มผลัดเซลล์ AHA ให้หน่อย
แรลฟ์: จัดให้แล้วค่ะ เซรั่ม AHA ตัวนี้มี Glycolic Acid 5% กับ Niacinamide 4% ช่วยผลัดผิวพร้อมปลอบผิวไปด้วย กด Run ประเมินดูได้เลยนะคะ
<action>[{"type":"create_formula","name":"เซรั่มผลัดเซลล์ AHA","items":[{"name":"Water (Aqua)","smiles":"O","concentration":90},{"name":"Glycolic Acid","smiles":"OCC(=O)O","concentration":5},{"name":"Niacinamide","smiles":"O=C(N)c1cccnc1","concentration":4},{"name":"Phenoxyethanol","smiles":"OCCOc1ccccc1","concentration":1}]}]</action>

ผู้ใช้: อันไหนเสี่ยงสุด
แรลฟ์: ตัวที่ต้องระวังสุดคือระคายเคืองผิว 62 อยู่ระดับสูงเลยค่ะ ลองลดตัวที่เข้มข้นลงหน่อยน่าจะช่วยได้เยอะ

ผู้ใช้: ลด Ethanol ลงหน่อย ค่าระคายเคืองสูงไป
แรลฟ์: ได้เลยค่ะ ลด Ethanol จาก 50 เหลือ 20% แล้วเติม Glycerin ปลอบผิวอีกนิด กด Run ประเมินใหม่ดูนะคะ
<action>[{"type":"set_concentration","name":"Ethanol","concentration":20},{"type":"add_substance","name":"Glycerin","smiles":"OCC(O)CO","concentration":5}]</action>

ผู้ใช้: ลด Ethanol เหลือ 8% เปลี่ยน Cinnamaldehyde เป็น Vanillin ที่อ่อนโยนกว่า เติม Glycerin แล้วตั้งชื่อสูตรว่า "ผิวสุข" แล้ว Run
แรลฟ์: ปรับให้ครบแล้วค่ะ ลด Ethanol เหลือ 8% เปลี่ยนเป็น Vanillin ที่อ่อนโยนกว่า เติม Glycerin ปลอบผิว ตั้งชื่อสูตร "ผิวสุข" เรียบร้อย กำลัง Run ประเมินให้เลยนะคะ
<action>[{"type":"set_concentration","name":"Ethanol","concentration":8},{"type":"replace_substance","from":"Cinnamaldehyde","to":"Vanillin","smiles":"O=Cc1ccc(O)c(OC)c1","concentration":1},{"type":"add_substance","name":"Glycerin","smiles":"OCC(O)CO","concentration":5},{"type":"rename_formula","name":"ผิวสุข"},{"type":"run"}]</action>"""

LAB_PROPOSAL_PROMPT = """
คุณเป็นผู้ช่วยในแชต Ralph Lab ตอบตามบทบาทที่ระบุ ใช้ภาษาเดียวกับผู้ใช้ ตอบสั้น อ่านง่าย
ใช้เฉพาะคะแนนผลคัดกรองที่ให้มาในบริบท ระบุความไม่แน่นอนและข้อมูลที่ยังขาด
ถ้ามีผลรายด้าน UI จะแสดงตารางและกราฟเอง ไม่ต้องเขียนตารางซ้ำ ผลคัดกรองมาจากแบบจำลอง
ห้ามอ้างว่าเป็นผลแล็บ ยืนยันความปลอดภัย รับรองประสิทธิผล หรืออ้างว่าได้ส่งงานหรือทดลองแล้ว
เมื่อเสนอสูตรที่มีส่วนผสมครบ ให้แนบหนึ่งบล็อกต่อสูตรในรูปแบบ JSON นี้:
<formula>{"name":"ชื่อสูตร","items":[{"name":"Water (Aqua)","smiles":"O","concentration":95},{"name":"Glycerin","smiles":"OCC(O)CO","concentration":5}]}</formula>
ตัวอย่างกำหนดรูปแบบเท่านั้น ให้กรอกชื่อและส่วนผสมตามสูตรที่กำลังเสนอจริง ระบุส่วนผสมทุกตัว
รวมถึงน้ำหรือเบสเป็น % w/w แบบตัวเลขที่รวมกันได้ 100 พอดี ระบุ SMILES เฉพาะสารที่มีโครงสร้างชัดเจน
สำหรับสารสกัด สารผสม หรือสารที่ไม่ทราบโครงสร้าง ให้ใส่ชื่อและเปอร์เซ็นต์โดยละ SMILES
ถ้าแนะนำเพียงบางส่วนผสมหรือให้คำแนะนำทั่วไป ให้ตอบเป็นข้อความโดยไม่แนบบล็อกสูตร
อย่าใช้ <action> และอย่าอ้างว่าสร้างหรือแก้สูตรแล้ว ผู้ใช้จะกดเพิ่มสูตรจากข้อเสนอเอง
"""

# These constraints are kept separate from the conversational prompt so the
# chemistry boundary remains explicit and easy to test/review.
SCIENTIFIC_AGENT_GUARD = """

กฎวิทยาศาสตร์และคำสั่ง Agent ที่ต้องทำตาม:
- ห้ามรับรองสูตรว่า "ปลอดภัย" หรือ "ไม่อันตราย" ก่อนมีผลประเมิน ให้เรียกว่า
  "สูตรตั้งต้นสำหรับคัดกรองความเสี่ยงต่ำ" และย้ำว่าเป็นผล in-silico
- QSAR นี้รับสารที่มีโครงสร้างโมเลกุลชัดเจนเท่านั้น ห้ามแทนสารสกัดพืชหรือสารผสม
  เช่น Witch Hazel/Hamamelis extract ด้วย SMILES ของโมเลกุลตัวแทนเพียงตัวเดียว
- เมื่อสร้างสูตรอ่อนโยน ให้เลือกสารโครงสร้างชัดเจนก่อน เช่น
  Glycerin = OCC(O)CO, Panthenol = OCC(C)(C)C(O)C(=O)NCCCO,
  Allantoin = NC(=O)NC1NC(=O)NC1=O, Betaine = C[N+](C)(C)CC(=O)[O-]
- ถ้าผลมี confidence ต่ำหรือ out-of-domain ห้ามสรุปว่าคะแนนสูงนั้นคือความรุนแรงจริง
  ให้บอกก่อนว่าผลไม่น่าเชื่อถือและควรตรวจ structure/coverage หรือใช้วิธี fallback
- คะแนนสูตรคำนวณแบบถ่วงความเข้มข้น ดังนั้นสารที่ได้คะแนนรายสารสูงแต่ใส่เพียง 5%
  มักเพิ่มคะแนนสูตรได้เพียงประมาณ 5 คะแนน ห้ามอ้างว่าสูตรจะถึงคะแนนเป้าหมายจากชื่อสารอย่างเดียว
- ถ้าผู้ใช้ระบุคะแนนเป้าหมาย ห้ามรับรองว่าถึงเป้าหมายก่อน Run ต้องเรียกว่า "ออกแบบเพื่อทดสอบ"
  และให้ผลจาก assessment engine เป็นตัวยืนยัน ห้ามเสนอสูตรอันตรายเป็นผลิตภัณฑ์ใช้งานจริง
"""


class ChatIn(BaseModel):
    question: str
    context: str | None = None
    surface: Literal["workspace", "lab"] = "workspace"
    lab_role: str | None = None


IngredientName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
LAB_FORMULA_BLOCK = re.compile(r"<(formula|action)>\s*(.*?)\s*</\1>", re.IGNORECASE | re.DOTALL)
LAB_FORMULA_MARKUP = re.compile(r"<(formula|action)>.*?(?:</\1>|$)", re.IGNORECASE | re.DOTALL)


class FormulaProposalItem(BaseModel):
    name: IngredientName
    smiles: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)] | None = None
    concentration: float = Field(strict=True, gt=0, le=100)


class FormulaProposal(BaseModel):
    name: IngredientName
    items: list[FormulaProposalItem] = Field(min_length=1, max_length=500)


class ChatOut(BaseModel):
    answer: str
    formula_proposals: list[FormulaProposal] | None = None


def _lab_formula_proposals(text: str) -> list[FormulaProposal]:
    """Keep only complete, importable recipe proposals from Lab agent replies."""
    proposals: list[FormulaProposal] = []
    for match in LAB_FORMULA_BLOCK.finditer(text):
        tag, content = match.groups()
        try:
            payload = json.loads(content)
        except ValueError:
            continue
        candidates = [payload]
        if tag.lower() == "action":
            if not isinstance(payload, list):
                continue
            candidates = [
                item for item in payload
                if isinstance(item, dict) and item.get("type") in ("create_formula", "set_formula")
            ]
        elif isinstance(payload, list):
            candidates = [{"items": payload}]
        for candidate in candidates:
            if not isinstance(candidate, dict):
                continue
            try:
                proposal = FormulaProposal.model_validate({"name": "สูตรที่แนะนำ", **candidate})
            except ValidationError:
                continue
            for item in proposal.items:
                if UNSUPPORTED_COMPOSITION.search(item.name):
                    item.smiles = None
            total = math.fsum(item.concentration for item in proposal.items)
            if math.isclose(total, 100, rel_tol=0, abs_tol=0.0001) and proposal not in proposals:
                proposals.append(proposal)
    return proposals


def _lab_reply(text: str) -> ChatOut:
    proposals = _lab_formula_proposals(text)
    answer = LAB_FORMULA_MARKUP.sub("", text).strip()
    if not answer:
        answer = "เสนอสูตรตามรายการด้านล่างค่ะ" if proposals else "ข้อมูลส่วนผสมหรือสัดส่วนยังไม่ครบสำหรับสร้างสูตรค่ะ"
    return ChatOut(answer=answer, formula_proposals=proposals or None)


def _completion_text(data: dict, use_openai: bool) -> str:
    if not use_openai:
        return data["choices"][0]["message"]["content"].strip()
    if data["status"] != "completed":
        return ""
    parts = []
    for item in data["output"]:
        if item["type"] != "message":
            continue
        for part in item["content"]:
            if part["type"] == "output_text":
                parts.append(part["text"])
            elif part["type"] == "refusal":
                parts.append(part["refusal"])
    return "\n".join(parts).strip()


async def _request_completion(
    client: httpx.AsyncClient, messages: list[dict[str, str]], *, use_openai: bool
) -> str:
    if use_openai:
        url, api_key = OPENAI_URL, settings.OPENAI_API_KEY
        payload = {
            "model": settings.OPENAI_MODEL,
            "input": messages,
            "max_output_tokens": MAX_COMPLETION_TOKENS,
            "store": False,
        }
    else:
        url, api_key = GROQ_URL, settings.GROQ_API_KEY
        payload = {
            "model": settings.GROQ_MODEL,
            "messages": messages,
            "temperature": 0.6,
            "top_p": 0.95,
            "max_tokens": MAX_COMPLETION_TOKENS,
        }

    provider = "OpenAI" if use_openai else "Groq"
    # Keep the existing rate-limit retry for Groq-only deployments. An available
    # fallback can answer without waiting for Groq's quota window to reset.
    attempts = 1 if use_openai or settings.OPENAI_API_KEY else 3
    try:
        for attempt in range(attempts):
            response = await client.post(url, headers={"Authorization": f"Bearer {api_key}"}, json=payload)
            if response.status_code != 429 or attempt == attempts - 1:
                break
            try:
                delay = float(response.headers.get("Retry-After", ""))
            except ValueError:
                delay = 1.5 * (2 ** attempt)
            if not math.isfinite(delay):
                delay = 8
            await asyncio.sleep(min(max(delay, 0.25), 8))
    except httpx.RequestError as cause:
        logger.warning("%s chat request failed (%s)", provider, type(cause).__name__)
        raise HTTPException(status_code=502, detail="ติดต่อผู้ให้บริการ AI ไม่สำเร็จ") from None

    if response.status_code == 429:
        raise HTTPException(status_code=429, detail="AI มีคำขอมากเกินโควตาชั่วคราว กรุณารอสักครู่แล้วลองใหม่")
    if response.status_code != 200:
        logger.warning("%s chat request returned HTTP %s", provider, response.status_code)
        raise HTTPException(status_code=502, detail="ผู้ให้บริการ AI ตอบกลับไม่สำเร็จ")
    try:
        text = _completion_text(response.json(), use_openai)
    except (ValueError, KeyError, IndexError, TypeError, AttributeError):
        text = ""
    if not text:
        logger.warning("%s returned no usable chat text", provider)
        raise HTTPException(status_code=502, detail="ผู้ให้บริการ AI ไม่ได้ส่งคำตอบ")
    return text


@router.post("/", response_model=ChatOut, response_model_exclude_none=True)
async def chat(body: ChatIn):
    question = (body.question or "").strip()
    if not question:
        raise HTTPException(status_code=400, detail="empty question")
    in_lab = body.surface == "lab" or bool(body.lab_role)

    # High-frequency demo intent: use a reviewed template rather than allowing
    # stochastic LLM output to invent extracts, omit preservation, or drift in
    # concentration on every request.
    if not in_lab and _is_toner_creation_request(question):
        return ChatOut(answer=_gentle_toner_fallback(question) or "")

    sensitisation_fixture = None if in_lab else _sensitisation_ui_test_fallback(question)
    if sensitisation_fixture:
        return ChatOut(answer=sensitisation_fixture)

    if not (settings.GROQ_API_KEY or settings.OPENAI_API_KEY):
        raise HTTPException(status_code=503, detail="GROQ_API_KEY or OPENAI_API_KEY must be configured")

    prompt = question
    if body.context:
        prompt = f"ข้อมูลผลประเมินปัจจุบัน:\n{body.context}\n\nคำถาม: {question}"

    system_prompt = LAB_PROPOSAL_PROMPT if in_lab else SYSTEM_TH + WORKSPACE_AGENT_PROMPT
    messages = [
        {"role": "system", "content": system_prompt + SCIENTIFIC_AGENT_GUARD},
        {"role": "user", "content": prompt},
    ]
    use_openai = not settings.GROQ_API_KEY

    text = ""
    invalid_names: list[str] = []
    mutation_requested = _is_workspace_mutation_request(question)
    action_error = False
    async with httpx.AsyncClient(timeout=30) as client:
        for attempt in range(3):
            try:
                text = await _request_completion(client, messages, use_openai=use_openai)
            except HTTPException as cause:
                if use_openai or not settings.OPENAI_API_KEY:
                    raise
                logger.info("Groq chat unavailable (%s); using OpenAI", cause.status_code)
                use_openai = True
                text = await _request_completion(client, messages, use_openai=True)

            if in_lab:
                reply = _lab_reply(text)
                if reply.formula_proposals or not LAB_FORMULA_MARKUP.search(text) or attempt > 0:
                    return reply
                messages.extend([
                    {"role": "assistant", "content": text},
                    {
                        "role": "user",
                        "content": (
                            "บล็อกสูตรก่อนหน้ามีข้อมูลไม่ครบ ให้แก้รูปแบบ <formula> สำหรับสูตรที่มีส่วนผสม "
                            "และสัดส่วนครบ 100% เท่านั้น ถ้าแนะนำเพียงบางส่วนให้ตอบโดยไม่แนบบล็อกสูตร "
                            "อย่าเดาส่วนผสมที่ขาด"
                        ),
                    },
                ])
                continue

            invalid_names = _unsupported_action_ingredients(text)
            actions = _parse_actions(text)
            action_error = mutation_requested and not actions
            if not invalid_names and not action_error:
                break
            if attempt >= 2:
                continue

            if invalid_names:
                allowed = ", ".join(GENTLE_ACTION_SUBSTANCES)
                correction = (
                    "คำตอบก่อนหน้าถูกระบบปฏิเสธ เพราะพยายามแทนสารสกัด/สารผสมด้วย SMILES เดี่ยว: "
                    f"{', '.join(invalid_names)} กรุณาสร้าง action ใหม่โดยไม่ใช้สารเหล่านั้น "
                    f"สำหรับสูตรอ่อนโยนให้เลือกจากรายการที่ตรวจสอบแล้วนี้เท่านั้น: {allowed}"
                )
            else:
                attempted = "มี <action> ที่ไม่สมบูรณ์หรือ JSON ผิดรูปแบบ" if _has_action_markup(text) else "ไม่มี <action>"
                correction = (
                    f"คำตอบก่อนหน้า{attempted} ทั้งที่ผู้ใช้สั่งแก้ workspace กรุณาตอบใหม่แบบกระชับ "
                    "โดยเริ่มคำตอบด้วย <action>[JSON array ที่ถูกต้อง]</action> ให้ครบทุกคำสั่งก่อนข้อความอธิบาย "
                    "ใช้ชื่อสารเดิมให้ตรงกับข้อมูลสูตรในบริบท และอย่ากล่าวว่าแก้เสร็จก่อนผู้ใช้ยืนยัน"
                )
            messages.extend(
                [
                    {"role": "assistant", "content": text},
                    {"role": "user", "content": correction},
                ]
            )

    # A model can ignore the corrective turn. Toner creation still has a
    # deterministic, registry-backed path so the user never receives an action
    # that is guaranteed to fail only after confirmation.
    if invalid_names:
        fallback = _gentle_toner_fallback(question)
        if fallback:
            text = fallback
        else:
            text = _strip_action_markup(text)
            text += "\n\nยังไม่เปลี่ยน workspace เพราะสูตรมีสารสกัดที่ไม่มีโครงสร้างโมเลกุลเดี่ยว กรุณาเลือกสารที่มีโครงสร้างยืนยันแล้วค่ะ"
    elif mutation_requested and not _parse_actions(text):
        text = _strip_action_markup(text)
        if text:
            text += "\n\n"
        text += "ยังไม่ได้เปลี่ยนสูตร เพราะ AI สร้างรายการคำสั่งไม่สมบูรณ์ กรุณาลองสั่งอีกครั้งค่ะ"
    return ChatOut(answer=text)
