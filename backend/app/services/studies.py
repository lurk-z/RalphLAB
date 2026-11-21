"""Versioned planning templates. Each order stores its plan and sources at intake."""

from calendar import monthrange
from datetime import date, datetime, timedelta, timezone
from statistics import mean, stdev

from fastapi import HTTPException
from app.schemas.study import StudyBrief, StageResult


def today():
    return datetime.now(timezone(timedelta(hours=7))).date()


# Each entry names the part of the primary source actually used by the template.
REFERENCES = {
    "ord": (
        "Kearnes et al. · The Open Reaction Database (2021)",
        "https://doi.org/10.1021/jacs.1c09820",
        "Schema · Outcomes and Provenance",
        "เชื่อมผลวิเคราะห์กับบันทึกต้นทางของแต่ละปฏิกิริยา",
    ),
    "assay": (
        "NCATS · Assay Guidance Manual",
        "https://www.ncbi.nlm.nih.gov/books/NBK53196/",
        "Statistical validation of assay performance parameters",
        "พิจารณาผลคัดกรองพร้อมข้อมูลชุดควบคุมก่อนตีความ",
    ),
    "stability": (
        "ICH Q1A(R2) · Stability Testing",
        "https://www.fda.gov/regulatory-information/search-fda-guidance-documents/q1ar2-stability-testing-new-drug-substances-and-products",
        "§2.2.6 · Testing Frequency",
        "ติดตามผลที่วัดได้ตามจุดเวลาในแผนการศึกษา",
    ),
    "environment": (
        "US EPA · Uniform Federal Policy for Quality Assurance Project Plans",
        "https://www.epa.gov/sites/default/files/documents/ufp_qapp_v1_0305.pdf",
        "Sample handling and custody / data assessment",
        "เชื่อมรหัสตัวอย่าง ประวัติการรับส่ง ข้อมูลเครื่องมือ และผลตรวจคุณภาพ",
    ),
    "precision": (
        "ICH Q2(R2) · Validation of Analytical Procedures",
        "https://www.fda.gov/media/161201/download",
        "Precision · Repeatability and Intermediate Precision",
        "ทบทวนความแปรปรวนของการวัดซ้ำและผลภายใต้เงื่อนไขที่ต่างกัน",
    ),
    "pilot": (
        "UK HSE · Plant modification / Change procedures",
        "https://www.hse.gov.uk/comah/sragtech/techmeasplantmod.htm",
        "Hazard analysis prior to transfer to pilot plant scale",
        "ทบทวนความเสี่ยงจากการเปลี่ยนขนาดก่อนรับบันทึกการผลิตนำร่อง",
    ),
}


def source(key):
    title, url, locator, principle = REFERENCES[key]
    return dict(title=title, url=url, locator=locator, principle=principle)


def stage(key, title, role, parents, ref, application, *, count=0, due=None):
    return dict(
        id=key,
        title=title,
        role=role,
        depends_on=parents,
        source=source(ref),
        application=application,
        minimum_values=count,
        due=due,
    )


def build_plan(body: StudyBrief):
    if body.discipline == "synthesis":
        count = body.reaction_steps
        plan = []
        for i in range(1, count + 1):
            parents = [f"S{i - 1}"] if i > 1 else []
            if body.parallel:
                if i == count:
                    parents = [f"S{count - 2}", f"S{count - 1}"]
                else:
                    parents = [f"S{i - 2}"] if i > 2 else []
            plan.append(
                stage(
                    f"S{i}",
                    f"บันทึกผลปฏิกิริยาขั้นที่ {i}",
                    "researcher",
                    parents,
                    "ord",
                    "ผูกผลที่สังเกตกับเลขบันทึกแล็บก่อนส่งต่อขั้นที่ใช้ผลนี้",
                )
            )
        return plan
    if body.discipline == "stability":
        plan = []
        for months in body.months:
            start = body.start_date
            year, month = divmod(start.year * 12 + start.month - 1 + months, 12)
            due = date(year, month + 1, min(start.day, monthrange(year, month + 1)[1]))
            plan.append(
                stage(
                    f"M{months}",
                    f"ผลติดตามเดือนที่ {months}",
                    "analyst",
                    [],
                    "stability",
                    "เทียบวันที่สังเกตกับกำหนดของโครงการและบันทึกค่าพร้อมหน่วย",
                    count=1,
                    due=due.isoformat(),
                )
            )
        return plan
    if body.discipline == "discovery":
        return [
            stage(
                "screen",
                "ผลคัดกรองและชุดควบคุม",
                "researcher",
                [],
                "assay",
                "รอรายงานผลคัดกรองที่ระบุชุดควบคุม",
            ),
            stage(
                "form",
                "ข้อมูลสูตรตำรับ",
                "formulator",
                [],
                "stability",
                "รวบรวมข้อมูลความคงตัวของสูตรจากการวัด",
            ),
            stage(
                "review",
                "ทบทวนหลักฐานทั้งสองชุด",
                "evaluator",
                ["screen", "form"],
                "assay",
                "ส่งผลคัดกรองและข้อมูลสูตรให้ทบทวนร่วมกัน พร้อมระบุข้อจำกัด",
            ),
        ]
    if body.discipline == "trace":
        return [
            stage(
                "samples",
                "ทะเบียนและประวัติตัวอย่าง",
                "researcher",
                [],
                "environment",
                "บันทึกรหัสตัวอย่างและเอกสารการรับส่ง",
            ),
            stage(
                "signal",
                "ผลจากเครื่องมือ",
                "analyst",
                ["samples"],
                "environment",
                "บันทึกค่าพร้อมหน่วยและรหัสข้อมูลต้นฉบับ",
                count=1,
            ),
            stage(
                "qc",
                "ทบทวนข้อมูลควบคุมคุณภาพ",
                "evaluator",
                ["samples"],
                "environment",
                "บันทึกผลตรวจข้อมูล QC ของชุดตัวอย่าง",
            ),
            stage(
                "review",
                "สรุปความใช้ได้ของข้อมูล",
                "evaluator",
                ["signal", "qc"],
                "environment",
                "รวบรวมผลวัดและผล QC ให้ผู้ทบทวน",
            ),
        ]
    if body.discipline == "validation":
        return [
            stage(
                "plan",
                "ขอบเขตวิธีและเกณฑ์ที่จะประเมิน",
                "director",
                [],
                "precision",
                "ระบุวิธี รุ่น และเกณฑ์ของโครงการก่อนประเมิน",
            ),
            stage(
                "repeat",
                "ผลการวัดซ้ำ",
                "analyst",
                ["plan"],
                "precision",
                "คำนวณค่าเฉลี่ยและส่วนเบี่ยงเบนมาตรฐานตัวอย่างจากค่าซ้ำในหน่วยเดียวกัน",
                count=2,
            ),
            stage(
                "vary",
                "ผลเมื่อเปลี่ยนผู้วิเคราะห์หรือเครื่องมือ",
                "analyst",
                ["plan"],
                "precision",
                "บันทึกเงื่อนไขที่เปลี่ยนและสรุปค่าซ้ำของชุดนี้แยกต่างหาก",
                count=2,
            ),
            stage(
                "review",
                "ทบทวนผลเทียบเกณฑ์ที่บันทึกไว้",
                "evaluator",
                ["repeat", "vary"],
                "precision",
                "ส่งข้อมูลทั้งสองชุดให้ผู้ทบทวนตัดสินตามเกณฑ์ที่กำหนด",
            ),
        ]
    return [
        stage(
            "scope",
            "ขอบเขตการเปลี่ยนขนาด",
            "director",
            [],
            "pilot",
            "ระบุรายการเปลี่ยนแปลงและเอกสารต้นทาง",
        ),
        stage(
            "review",
            "เอกสารทบทวนความเสี่ยงโดยวิศวกร",
            "evaluator",
            ["scope"],
            "pilot",
            "รอเลขเอกสารและผลการพิจารณาของผู้รับผิดชอบ",
        ),
        stage(
            "campaign",
            "บันทึกรอบนำร่อง",
            "researcher",
            ["review"],
            "pilot",
            "ผูกบันทึกรอบนำร่องกับเอกสารทบทวนและบันทึกประจำกะ",
        ),
        stage(
            "handover",
            "สรุปความเบี่ยงเบนและส่งมอบ",
            "evaluator",
            ["campaign"],
            "pilot",
            "ระบุรายการเบี่ยงเบนและข้อจำกัดจากบันทึกหน้างาน",
        ),
    ]


def stages(row):
    complete = {
        e["stage_id"]
        for e in row.events
        if e.get("result", {}).get("disposition") == "record"
    }
    result = []
    for step in row.request["stages"]:
        if step["id"] in complete:
            state = "complete"
        elif row.state in {"approved", "rejected"}:
            state = "closed"
        elif not complete.issuperset(step["depends_on"]):
            state = "blocked"
        elif step["due"] and step["due"] > today().isoformat():
            state = "scheduled"
        else:
            state = "ready"
        result.append({**step, "status": state})
    return result


def assess(step, body: StageResult):
    if step["status"] != "ready":
        raise HTTPException(409, "ขั้นนี้ยังไม่เปิดรับข้อมูลหรือปิดแล้ว")
    if body.observed_on > today() or (
        step["due"] and body.observed_on.isoformat() < step["due"]
    ):
        raise HTTPException(422, "วันที่สังเกตต้องถึงรอบและไม่เกินวันนี้")
    if body.disposition == "record" and len(body.measurements) < step["minimum_values"]:
        raise HTTPException(422, f"ขั้นนี้ต้องมีค่าที่วัดอย่างน้อย {step['minimum_values']} ค่า")
    if not body.measurements:
        return None
    values = body.measurements
    return {
        "n": len(values),
        "mean": mean(values),
        "sd": stdev(values) if len(values) > 1 else None,
        "unit": body.unit,
    }
