"""Project-scoped handoff inbox, human decisions, and read-only sharing."""

import json
from datetime import date, datetime, time, timedelta, timezone
from typing import Literal
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import JSON, cast, func, or_, select
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, get_current_user
from app.api.chat import ChatIn, chat
from app.db.session import get_db
from app.models.project import Project
from app.models.work_order import WorkOrder, WorkOrderReader
from app.schemas.work_order import Brief, Input, OrderAction, OrderRequest
from app.services.work_orders import dispatch, final_report, record
from app.schemas.study import ChatReference, StageResult, StudyBrief
from app.services.studies import assess, build_plan, stages
from app.services.protein import INSULIN, MODELS, PROTEIN, ProteinPose, ProteinRun, alignment_frames, score
from app.services import insulin_case

router = APIRouter()


def visible_projects(user):
    condition = Project.owner_id == user.id
    if user.verified_email:
        shared = select(WorkOrderReader.project_id).where(
            WorkOrderReader.email == user.verified_email.lower()
        )
        condition = or_(condition, Project.id.in_(shared))
    return select(Project).where(Project.deleted_at.is_(None), condition)


def access(db, user, project_id, *, write=False):
    query = visible_projects(user).where(Project.id == project_id)
    if write:
        query = query.with_for_update()
    project = db.scalar(query)
    if project is None:
        raise HTTPException(404, "ไม่พบโครงการ")
    if write and project.owner_id != user.id:
        raise HTTPException(403, "ต้องเป็นเจ้าของโครงการ")
    return project


def output(row):
    return {
        "id": row.id,
        "project_id": row.project_id,
        "request": row.request,
        "state": row.state,
        "events": row.events,
        "created_at": row.created_at,
        "report": final_report(row),
        **({"stages": stages(row)} if row.request.get("kind") == "study" else {}),
    }


@router.get("/projects")
def projects(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return [
        {"id": p.id, "name": p.name, "owner": p.owner_id == user.id}
        for p in db.scalars(
            visible_projects(user).order_by(Project.updated_at.desc(), Project.id.desc())
        )
    ]


@router.get("/projects/{project_id}/orders")
def orders(
    project_id: int, activity_date: date | None = None,
    user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)
):
    access(db, user, project_id)
    query = select(WorkOrder).where(WorkOrder.project_id == project_id)
    if activity_date is not None:
        if activity_date in (date.min, date.max):
            raise HTTPException(422, "วันที่อยู่นอกช่วงที่รองรับ")
        bangkok = timezone(timedelta(hours=7))
        start = datetime.combine(activity_date, time.min, tzinfo=bangkok).astimezone(timezone.utc)
        end = start + timedelta(days=1)
        if db.get_bind().dialect.name == "postgresql":
            events = func.json_array_elements(WorkOrder.events).table_valued("value")
            timestamp = cast(events.c.value, JSON)["at"].as_string()
        else:
            events = func.json_each(WorkOrder.events).table_valued("value")
            timestamp = func.json_extract(events.c.value, "$.at")
        # record() emits UTC ISO timestamps. Fixed-width seconds boundaries
        # keep midnight inclusive even if the timestamp has no fractional part.
        in_day = select(1).select_from(events).where(
            func.substr(timestamp, 1, 19) >= start.strftime("%Y-%m-%dT%H:%M:%S"),
            func.substr(timestamp, 1, 19) < end.strftime("%Y-%m-%dT%H:%M:%S"),
        ).correlate(WorkOrder).exists()
        query = query.where(in_day)
    rows = db.scalars(query.order_by(WorkOrder.created_at.desc(), WorkOrder.id))
    return [output(row) for row in rows]


@router.get("/projects/{project_id}/orders/{order_id}")
def get_order(project_id: int, order_id: UUID, user: CurrentUser = Depends(get_current_user),
              db: Session = Depends(get_db)):
    access(db, user, project_id)
    row = db.get(WorkOrder, (project_id, str(order_id)))
    if row is None:
        raise HTTPException(404, "ไม่พบใบงาน")
    return output(row)


class DirectorBrief(BaseModel):
    id: UUID
    chat_turn_id: UUID | None = None
    chat_sources: list[ChatReference] = Field(default_factory=list, max_length=14)
    title: str = Field(min_length=1, max_length=240)
    draft: str = Field(min_length=1, max_length=7000)
    assignee: Literal["researcher", "formulator", "analyst", "evaluator"]


@router.post("/projects/{project_id}/director-briefs")
def director_brief(project_id: int, body: DirectorBrief, user: CurrentUser = Depends(get_current_user),
                   db: Session = Depends(get_db)):
    access(db, user, project_id, write=True)
    intake = body.model_dump(mode="json", exclude={"chat_sources", "chat_turn_id"})
    row = db.get(WorkOrder, (project_id, str(body.id)))
    if row:
        if row.events[0].get("intake") != intake:
            raise HTTPException(409, "รหัสนี้ใช้กับโจทย์อื่นแล้ว")
        return output(row)
    row = WorkOrder(project_id=project_id, id=str(body.id), events=[], state="awaiting_inputs",
                    request={"kind": "director_brief", "brief": body.title, "draft": body.draft,
                             "assignee": body.assignee, "version": "R1",
                             **({"chat_sources": [s.model_dump(mode="json") for s in body.chat_sources]} if body.chat_sources else {})})
    record(row, "head", "director", body.title, intake=intake, actor=user.id)
    record(row, "director", body.assignee, body.draft)
    db.add(row)
    db.commit()
    return output(row)


@router.post("/projects/{project_id}/briefs")
def start_brief(project_id: int, body: Brief, user: CurrentUser = Depends(get_current_user),
                db: Session = Depends(get_db)):
    access(db, user, project_id, write=True)
    intake = body.model_dump(mode="json")
    row = db.get(WorkOrder, (project_id, str(body.id)))
    if row is not None:
        if row.events[0].get("intake") != intake:
            raise HTTPException(409, "รหัสนี้ใช้กับโจทย์อื่นแล้ว")
        return output(row)
    row = WorkOrder(project_id=project_id, id=str(body.id), state="awaiting_inputs", events=[],
                    request={"id": str(body.id), "brief": body.brief, "endpoint": body.endpoint})
    record(row, "head", "director", body.brief, actor=user.id, intake=intake)
    if body.source == "example":
        def example(version, water, glycerin):
            return {"version": version, "ingredients": [{"name": "Aqua", "percent": water},
                                                      {"name": "Glycerin", "percent": glycerin}]}
        snapshot = OrderRequest(id=body.id, brief=body.brief, endpoint=body.endpoint, locked=["Glycerin"],
                                baseline=example("V1", 95, 5), candidate=example("V2-A", 94, 6))
        row.request = snapshot.model_dump(mode="json")
        record(row, "director", "head", "ใช้คู่สูตรตัวอย่าง Aqua/Glycerin ตามที่เลือก")
        dispatch(db, row)
    else:
        record(row, "director", "head", "รอสูตรต้นทาง รุ่นที่เสนอ และรายการสารที่ล็อกก่อนส่งใบงาน")
    db.add(row)
    db.commit()
    return output(row)


@router.get("/protein/gfp")
def protein_reference():
    return PROTEIN


@router.get("/protein/insulin")
def insulin_reference():
    return INSULIN


@router.get("/protein/comparisons/insulin-lispro-v1")
def insulin_comparison():
    return {"report": insulin_case.comparison_summary(),
            "structures": insulin_case.STRUCTURE_COMPARISON["structures"]}


@router.post("/projects/{project_id}/studies")
def start_study(project_id: int, body: StudyBrief, user: CurrentUser = Depends(get_current_user),
                db: Session = Depends(get_db)):
    access(db, user, project_id, write=True)
    intake = body.model_dump(mode="json", exclude={"chat_sources", "chat_turn_id"})
    if not body.case_template:
        intake.pop("case_template", None)  # Existing intake snapshots predate named cases.
    row = db.get(WorkOrder, (project_id, str(body.id)))
    if row is not None:
        if row.request.get("kind") != "study" or row.events[0].get("intake") != intake:
            raise HTTPException(409, "รหัสนี้ใช้กับโจทย์อื่นแล้ว")
        return output(row)
    plan = insulin_case.plan() if body.case_template else build_plan(body)
    row = WorkOrder(project_id=project_id, id=str(body.id), state="in_progress", events=[],
                    request={"kind": "study", "version": "R1", "brief": body.brief,
                             "discipline": body.discipline, "stages": plan,
                             **({"chat_sources": [s.model_dump(mode="json") for s in body.chat_sources]} if body.chat_sources else {}),
                             **({"case_template": body.case_template} if body.case_template else {})})
    record(row, "head", "director", body.brief, actor=user.id, intake=intake)
    record(row, "director", "head", "จัดแผนและเลือกเอกสารอ้างอิงตามประเภทงาน", stage_ids=[s["id"] for s in plan])
    if body.discipline == "discovery" and not body.case_template:
        keywords = [(PROTEIN, ("gfp", "1ema", "green fluorescent protein", "โปรตีนเรืองแสง")),
                    (INSULIN, ("insulin", "อินซูลิน", "3i40"))]
        for model, names in keywords:
            if any(name in body.brief.casefold() for name in names):
                record(row, "researcher", "head", f"เลือกโครงสร้าง {model['title']} ตามชื่อที่ระบุในโจทย์",
                       structure={"pdb": model["pdb"], "chain": model["chain"], "url": model["source_url"],
                                  "observed_positions": len(model["trace"]),
                                  "application": "ใช้พิกัด Cα ที่ฝากใน PDB เป็นจุดอ้างอิงเปรียบเทียบรูปทรงในแบบฝึก"})
    db.add(row)
    db.commit()
    return output(row)


def study_for_update(db, user, project_id, order_id):
    access(db, user, project_id, write=True)
    row = db.get(WorkOrder, (project_id, str(order_id)))
    if row is None or row.request.get("kind") != "study":
        raise HTTPException(404, "ไม่พบใบงานวิจัย")
    return row


def replay(row, command):
    for event in row.events:
        existing = event.get("command")
        if existing and existing["id"] == command["id"]:
            if existing != command:
                raise HTTPException(409, "รหัสคำสั่งซ้ำกับคำขออื่น")
            return True
    if command["expected_sequence"] != len(row.events):
        raise HTTPException(409, "ข้อมูลเปลี่ยนแล้ว โหลดใบงานล่าสุดก่อน")
    return False


@router.post("/projects/{project_id}/orders/{order_id}/stages/{stage_id}/results")
def stage_result(project_id: int, order_id: UUID, stage_id: str, body: StageResult,
                 user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    row = study_for_update(db, user, project_id, order_id)
    if row.request.get("case_template"):
        raise HTTPException(409, "เปิดการเปรียบเทียบบนโต๊ะเพื่อบันทึกหลักฐานจากเคสนี้")
    data = body.model_dump(mode="json")
    command = {"stage": stage_id, **data}
    if replay(row, command):
        return output(row)
    step = next((s for s in stages(row) if s["id"] == stage_id), None)
    if step is None:
        raise HTTPException(404, "ไม่พบขั้นงาน")
    stats = assess(step, body)
    record(row, step["role"], "head", body.finding, actor=user.id, stage_id=stage_id,
           command=command, result={k: v for k, v in data.items() if k not in {"id", "expected_sequence"}},
           source=step["source"], application=step["application"], statistics=stats)
    if all(s["status"] == "complete" for s in stages(row)):
        row.state = "awaiting_approval"
    db.commit()
    return output(row)


def require_open_protein_study(row):
    if row.request.get("case_template") or row.request["discipline"] != "discovery" or row.state not in {"in_progress", "awaiting_approval"}:
        raise HTTPException(409, "ใช้โต๊ะโปรตีนได้ในใบงานพัฒนายาที่ยังเปิดอยู่")


class ComparisonRun(Input):
    id: UUID
    expected_sequence: int = Field(ge=1)


@router.post("/projects/{project_id}/orders/{order_id}/insulin-comparisons")
def run_insulin_comparison(project_id: int, order_id: UUID, body: ComparisonRun,
                          user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    row = study_for_update(db, user, project_id, order_id)
    command = {**body.model_dump(mode="json"), "case": insulin_case.VERSION}
    if replay(row, command):
        return output(row)
    if row.request.get("case_template") != insulin_case.VERSION or row.state != "in_progress":
        raise HTTPException(409, "เคสนี้ยังไม่เปิดรับการเปรียบเทียบหรือบันทึกผลแล้ว")
    for sender, recipient, message, step, report in insulin_case.run_steps(body.id):
        details = {}
        if step["phase"] == "structures":
            details.update(command=command, requested_by=user.id)
        if report:
            details["comparison_report"] = report
        record(row, sender, recipient, message, comparison_step=step, stage_id=step["phase"], **details)
    row.state = "awaiting_approval"
    db.commit()
    return output(row)


@router.post("/projects/{project_id}/orders/{order_id}/protein-runs")
def run_protein_alignment(project_id: int, order_id: UUID, body: ProteinRun,
                          user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    row = study_for_update(db, user, project_id, order_id)
    command = body.model_dump(mode="json")
    if replay(row, command):
        return output(row)
    require_open_protein_study(row)
    previous = None
    if body.start_from == "latest":
        previous = next((e for e in reversed(row.events) if e.get("pose", {}).get("model") == body.model), None)
    angles = previous["pose"]["angles"] if previous else MODELS[body.model]["start_angles"]
    for phase, sender, recipient, message, geometry in alignment_frames(body.model, angles):
        frame = {"run_id": str(body.id), "phase": phase, **geometry}
        details = {}
        if phase == "inspect":
            details.update(command=command, requested_by=user.id)
            frame["input_pose_event_id"] = previous["id"] if previous else None
        if phase == "verify":
            details.update(actor=sender, pose={"kind": "educational_model", **geometry})
        record(row, sender, recipient, message, protein_step=frame, **details)
    db.commit()
    return output(row)


@router.post("/projects/{project_id}/orders/{order_id}/protein-poses")
def save_pose(project_id: int, order_id: UUID, body: ProteinPose, user: CurrentUser = Depends(get_current_user),
              db: Session = Depends(get_db)):
    row = study_for_update(db, user, project_id, order_id)
    command = body.model_dump(mode="json")
    if replay(row, command):
        return output(row)
    require_open_protein_study(row)
    model = MODELS[body.model]
    record(row, "researcher", "head", f"แนบแบบฝึกโครงสร้าง {model['title']} สามมิติ", actor=user.id, command=command,
           pose={"model": body.model, "pdb": model["pdb"], "angles": body.angles, "rmsd": score(body.model, body.angles),
                 "source_url": model["source_url"], "kind": "educational_model"})
    db.commit()
    return output(row)


@router.post("/projects/{project_id}/orders")
def create(
    project_id: int,
    body: OrderRequest,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    access(db, user, project_id, write=True)
    snapshot = body.model_dump(mode="json")
    row = db.get(WorkOrder, (project_id, str(body.id)))
    if row is None:
        row = WorkOrder(
            project_id=project_id, id=str(body.id), request=snapshot, events=[], state="created"
        )
        record(row, "head", "director", body.brief, actor=user.id)
        dispatch(db, row)
        db.add(row)
        db.commit()
    elif row.state == "awaiting_inputs":
        if (row.request["brief"], row.request["endpoint"]) != (body.brief, body.endpoint):
            raise HTTPException(409, "โจทย์หรือด้านที่ตรวจไม่ตรงกับใบงานเดิม")
        row.request = snapshot
        record(row, "head", "director", "แนบคู่สูตรและข้อจำกัดแล้ว", actor=user.id)
        dispatch(db, row)
        db.commit()
    elif row.request != snapshot:
        raise HTTPException(409, "รหัสใบงานนี้ใช้กับคำขออื่นแล้ว")
    return output(row)


@router.post("/projects/{project_id}/orders/{order_id}/actions")
def action(
    project_id: int,
    order_id: UUID,
    body: OrderAction,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    access(db, user, project_id, write=True)
    row = db.get(WorkOrder, (project_id, str(order_id)))
    if row is None:
        raise HTTPException(404, "ไม่พบใบงาน")
    if row.state == "awaiting_inputs":
        raise HTTPException(409, "แนบสูตรทั้งสองรุ่นก่อน")
    command = body.model_dump(mode="json")
    if replay(row, command):
        return output(row)
    version = (row.request.get("candidate") or {}).get("version", row.request.get("version"))
    if body.version != version:
        raise HTTPException(409, "ข้อมูลเปลี่ยนแล้ว โหลดใบงานล่าสุดก่อน")
    if body.action == "recheck" and row.state == "needs_evidence":
        record(row, "head", "director", body.note, actor=user.id, command=command)
        dispatch(db, row)
    elif body.action == "reject" and row.state in {"awaiting_approval", "needs_evidence", "in_progress"}:
        row.state = "rejected"
        record(row, "head", "director", body.note, actor=user.id, command=command)
    elif body.action == "approve" and row.state == "awaiting_approval":
        row.state = "approved"
        record(row, "head", "director", body.note, actor=user.id, command=command)
    else:
        raise HTTPException(409, "สถานะใบงานไม่อนุญาตให้ทำรายการนี้")
    db.commit()
    return output(row)


class Reader(Input):
    email: str = Field(min_length=3, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class Advice(Input):
    id: UUID
    role: Literal["director", "researcher", "formulator", "analyst", "evaluator"]
    expected_sequence: int = Field(ge=1)
    stage_id: str | None = Field(default=None, min_length=1, max_length=32)


@router.post("/projects/{project_id}/orders/{order_id}/advice")
async def advice(
    project_id: int,
    order_id: UUID,
    body: Advice,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    def current():
        access(db, user, project_id, write=True)
        row = db.get(WorkOrder, (project_id, str(order_id)), populate_existing=True)
        if row is None:
            raise HTTPException(404, "ไม่พบใบงาน")
        if row.state == "awaiting_inputs":
            raise HTTPException(409, "แนบสูตรทั้งสองรุ่นก่อน")
        for event in row.events:
            if event.get("advice_id") == str(body.id):
                if (event["sender"] != body.role or event["source_sequence"] != body.expected_sequence
                        or event.get("reviewed_stage") != body.stage_id):
                    raise HTTPException(409, "รหัสคำขอซ้ำ")
                return row, True
        if len(row.events) != body.expected_sequence:
            raise HTTPException(409, "ข้อมูลเปลี่ยนแล้ว โหลดใบงานล่าสุดก่อน")
        return row, False

    row, existing = current()
    if existing:
        return output(row)
    review = {}
    if row.request.get("kind") == "study":
        if row.state in {"approved", "rejected"}:
            raise HTTPException(409, "ใบงานนี้ปิดแล้ว")
        step = next((s for s in stages(row) if s["id"] == body.stage_id), None)
        if step is None or step["role"] != body.role:
            raise HTTPException(422, "เลือกขั้นและบทบาทที่รับผิดชอบขั้นนี้")
        last = next((e for e in reversed(row.events) if e.get("stage_id") == step["id"] and "result" in e), None)
        # The model receives this bounded evidence summary, with no apparatus or mutation tools.
        sources = [step["source"], *(last["result"]["literature"] if last else [])]
        packet = {"role": body.role, "discipline": row.request["discipline"], "stage": step["title"],
                  "state": step["status"], "application": step["application"], "sources": sources,
                  "last_observation": last["result"]["observed_on"] if last else None,
                  "statistics": last.get("statistics") if last else None}
        review = {"reviewed_stage": step["id"], "sources_sent": sources}
        question = ("อธิบายสั้นๆ ว่าแหล่งใดรองรับการจัดขั้นนี้และระบบใช้หลักการนั้นอย่างไร "
                    "ระบุผลที่มีและข้อมูลที่ยังขาดตามบริบทเท่านั้น ห้ามเสนอวิธีทดลองหรือรับรองผล")
    else:
        if body.stage_id:
            raise HTTPException(422, "ใบงานสูตรไม่มีขั้นวิจัยนี้")
        latest = {e["sender"]: e for e in row.events if "tool" in e}
        handoff = [e for e in latest.values() if body.role in (e["sender"], e["recipient"])]
        packet = {"role": body.role, "brief": row.request["brief"], "version": row.request["candidate"]["version"],
                  "state": row.state, "handoff": handoff}
        question = "สรุปใบงานตามบทบาทของคุณจากหลักฐานที่ให้มา บอกข้อจำกัดและสิ่งที่ผู้รับควรตรวจต่อ ห้ามอนุมัติรุ่นสูตร"
    context = json.dumps(packet, ensure_ascii=False)
    if len(context) > 18000:
        raise HTTPException(422, "ข้อมูลในใบงานนี้เกินขนาดที่ส่งให้โมเดลได้")
    db.rollback()  # Release the project lock while waiting for the provider.
    reply = await chat(
        ChatIn(
            surface="lab",
            context=context,
            question=question,
        )
    )
    row, existing = current()
    if not existing:
        record(
            row,
            body.role,
            "head",
            reply.answer,
            advice_id=str(body.id),
            source_sequence=body.expected_sequence,
            requested_by=user.id,
            **review,
        )
        db.commit()
    return output(row)


@router.get("/projects/{project_id}/readers")
def readers(
    project_id: int, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)
):
    access(db, user, project_id, write=True)
    return list(
        db.scalars(
            select(WorkOrderReader.email)
            .where(WorkOrderReader.project_id == project_id)
            .order_by(WorkOrderReader.email)
        )
    )


@router.put("/projects/{project_id}/readers")
def add_reader(
    project_id: int,
    body: Reader,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    access(db, user, project_id, write=True)
    email = body.email.lower()
    if db.get(WorkOrderReader, (project_id, email)) is None:
        db.add(WorkOrderReader(project_id=project_id, email=email))
        db.commit()
    return Response(status_code=204)


@router.delete("/projects/{project_id}/readers")
def remove_reader(
    project_id: int,
    body: Reader,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    access(db, user, project_id, write=True)
    reader = db.get(WorkOrderReader, (project_id, body.email.lower()))
    if reader is not None:
        db.delete(reader)
        db.commit()
    return Response(status_code=204)
