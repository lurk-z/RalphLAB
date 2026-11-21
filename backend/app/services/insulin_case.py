"""Versioned comparison of geometric observations and published pharmacokinetic evidence."""

from app.services.insulin_comparison import STRUCTURE_COMPARISON
from app.services.insulin_evidence import INSULIN_EVIDENCE

VERSION = "insulin-lispro-v1"
PHASES = [
    ("structures", "researcher", "เทียบโครงสร้างอินซูลินสองชนิด"),
    ("interface", "formulator", "ดูจุดสัมผัสระหว่างโมเลกุล"),
    ("absorption", "analyst", "อ่านผลการดูดซึมจากการศึกษาในคน"),
    ("conclusion", "evaluator", "ประเมินว่าหลักฐานตอบโจทย์ได้แค่ไหน"),
]


def sources():
    structural = [
        dict(
            title=s["pdb"],
            url=s["source_url"],
            locator="X-ray diffraction · คู่โมเลกุล AB และ CD",
            principle="เปรียบเทียบตำแหน่งของโมเลกุลในผลึก",
        )
        for s in STRUCTURE_COMPARISON["structures"]
    ]
    clinical = INSULIN_EVIDENCE["source"]
    study = dict(
        title=clinical["title"],
        url=clinical["url"],
        locator=clinical["locator"],
        principle="ใช้ผลที่วัดในซีรัมภายใต้เงื่อนไขการศึกษาที่รายงาน",
    )
    return {
        "structures": structural,
        "interface": structural,
        "absorption": [study],
        "conclusion": [*structural, study],
    }


def plan():
    refs = sources()
    applications = [
        "เทียบพิกัดที่ฝากใน PDB และระบุว่าสายใดเป็นโมเลกุลเดียวกัน",
        STRUCTURE_COMPARISON["contact_rule"],
        "แสดงค่าสรุปที่ตีพิมพ์แยกตามตัวชี้วัดและแขนการศึกษา",
        "แยกผลที่สังเกตได้ออกจากคำอธิบายกลไกและข้อจำกัด",
    ]
    result = []
    for (key, role, title), application in zip(PHASES, applications):
        result.append(
            dict(
                id=key,
                title=title,
                role=role,
                depends_on=[result[-1]["id"]] if result else [],
                source=refs[key][0],
                application=application,
                minimum_values=0,
                due=None,
            )
        )
    return result


def comparison_summary():
    data = STRUCTURE_COMPARISON
    structures = []
    for item in data["structures"]:
        structure = {
            k: item[k]
            for k in ("pdb", "title", "source_url", "paper_url", "resolution_angstrom")
        }
        for field in ("contacts", "site_distances"):
            structure[field] = []
            for c in item[field]:
                endpoints = {
                    side: {k: c[side][k] for k in ("chain", "number", "name", "atom")}
                    for side in ("left", "right")
                }
                structure[field].append(
                    {**endpoints, "distance_angstrom": c["distance_angstrom"]}
                )
        structures.append(structure)
    return {
        "version": VERSION,
        "structures": structures,
        "contact_rule": data["contact_rule"],
        "interface_note": data["interface_note"],
        "limitations": data["limitations"],
        "alignment": data["alignment"],
        "evidence": INSULIN_EVIDENCE,
    }


def run_steps(run_id):
    refs = sources()
    summary = comparison_summary()
    counts = " · ".join(
        f"{s['pdb']} พบ {len(s['contacts'])} คู่" for s in summary["structures"]
    )
    observations = [
        "วางโครงสร้างผลึก 1TRZ และ 1LPH ในกรอบพิกัดเดียวกัน",
        f"จุดสัมผัสที่ตรวจพบในบริเวณที่เลือก · {counts}",
        INSULIN_EVIDENCE["observation"],
        INSULIN_EVIDENCE["hypothesis"],
    ]
    for i, (key, role, _) in enumerate(PHASES):
        step = dict(version=VERSION, run_id=str(run_id), phase=key, sources=refs[key])
        recipient = PHASES[i + 1][1] if i + 1 < len(PHASES) else "head"
        yield (
            role,
            recipient,
            observations[i],
            step,
            summary if key == "conclusion" else None,
        )
