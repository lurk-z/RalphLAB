"""Submit or read a cosmetic QSAR job in the selected user's project."""
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.api.assessments import require_assessment_enabled
from app.core.auth import CurrentUser, get_current_user
from app.core.config import settings
from app.db.session import get_db
from app.models import Assessment, AssessmentStatus, IngredientRegistry, Project
from app.services import assessment_service

router = APIRouter()


class Ingredient(BaseModel):
    cid: Literal[962, 753, 936, 4678, 1176, 311]
    percent: float = Field(gt=0, le=100, allow_inf_nan=False)


class Screening(BaseModel):
    id: UUID
    region: Literal["face", "eye", "hand", "forearm"]
    ingredients: list[Ingredient] = Field(min_length=1, max_length=6)


def owner_project(db, project, user, lock=False):
    stmt = select(Project.id).where(Project.id == project, Project.owner_id == user.id,
                                    Project.deleted_at.is_(None))
    if db.scalar(stmt.with_for_update() if lock else stmt) is None:
        raise HTTPException(404, "ไม่พบโปรเจกต์")


def job_view(row):
    inputs = [{"name": i.get("name") or i.get("smiles"), "cid": i.get("cid"), "percent": i["concentration"]}
              for i in row.formula]
    endpoints = {}
    for k, score in (row.result or {}).get("endpoints", {}).items():
        if k not in {"skin", "eye", "sens", "acute"}:
            continue
        conf = score.get("confidence") or {}
        endpoints[k] = {"peak_score": score.get("peak_score"), "confidence": conf.get("level"),
                        "in_domain": conf.get("in_domain")}
    state = "complete" if row.status == AssessmentStatus.completed else row.status.value
    return {"id": row.id, "state": state, "formula": {"region": row.region, "ingredients": inputs},
            "result": {"endpoints": endpoints} if endpoints else None,
            "issue": "เครื่องคำนวณไม่สามารถประเมินสูตรนี้ได้" if row.status == AssessmentStatus.failed else None}


@router.get("/projects/{project}/chat-qsar")
def read_job(project: int, job: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    owner_project(db, project, user)
    stmt = select(Assessment).where(Assessment.project_id == project, Assessment.owner_id == user.id)
    if job == "latest":
        row = db.scalar(stmt.order_by(Assessment.created_at.desc(), Assessment.id.desc()).limit(1))
        return job_view(row) if row else None
    try:
        job_id = str(UUID(job))
    except ValueError:
        raise HTTPException(422, "เลขงาน QSAR ไม่ถูกต้อง") from None
    row = db.scalar(stmt.where(Assessment.id == job_id))
    if row is None:
        raise HTTPException(404, "ไม่พบงาน QSAR ในโปรเจกต์นี้")
    return job_view(row)


def replay_job(row, user, project, body):
    if row is None or row.owner_id != user.id or row.project_id != project or row.region != body.region:
        raise HTTPException(409, "รหัสงานถูกใช้แล้ว")
    if [(i.get("cid"), i.get("concentration")) for i in row.formula] != [(i.cid, i.percent) for i in body.ingredients]:
        raise HTTPException(409, "รหัสงานนี้ใช้กับอีกสูตรหนึ่ง")
    return job_view(row)


@router.post("/projects/{project}/chat-qsar", dependencies=[Depends(require_assessment_enabled)])
async def submit_job(project: int, body: Screening, background: BackgroundTasks,
                     user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    owner_project(db, project, user, lock=True)
    if len({i.cid for i in body.ingredients}) != len(body.ingredients) or sum(i.percent for i in body.ingredients) > 100.0001:
        raise HTTPException(422, "กรุณาระบุสารไม่ซ้ำ และสัดส่วนรวมไม่เกิน 100%")
    if all(i.cid == 962 for i in body.ingredients):
        raise HTTPException(422, "เพิ่มสารที่จะประเมินในสูตรน้ำ")
    job_id = str(body.id)
    old = db.get(Assessment, job_id)
    if old is not None:
        return replay_job(old, user, project, body)
    formula = []
    for i in body.ingredients:
        query = select(IngredientRegistry).where(IngredientRegistry.pubchem_cid == i.cid,
                                                  IngredientRegistry.verification_status == "verified")
        matches = [r for r in db.scalars(query.order_by(IngredientRegistry.id))
                   if r.canonical_smiles and (r.qsar_eligible or (i.cid == 962 and r.canonical_smiles == "O"))]
        if len({r.canonical_smiles for r in matches}) != 1:
            raise HTTPException(422, f"ทะเบียนยังไม่มีโครงสร้างที่ยืนยันได้สำหรับ CID {i.cid}")
        ing = matches[0]
        formula.append({"cid": i.cid, "smiles": ing.canonical_smiles, "name": ing.inci_name or ing.canonical_name,
                        "concentration": i.percent})
    row = Assessment(id=job_id, owner_id=user.id, project_id=project, region=body.region,
                     formula=formula, status=AssessmentStatus.queued)
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return replay_job(db.get(Assessment, job_id), user, project, body)
    if settings.ASSESSMENT_EXECUTION_MODE == "inline":
        if settings.ASSESSMENT_WAIT_FOR_RESULT:
            await run_in_threadpool(assessment_service.process_assessment_inline, job_id)
            db.refresh(row)
        else:
            background.add_task(assessment_service.process_assessment_inline, job_id)
    else:
        try:
            assessment_service.enqueue_assessment(job_id)
        except Exception:
            # Persist the dispatch failure for this UUID. A replay can never claim
            # that an undispatched job is still waiting for a worker.
            row.status = AssessmentStatus.failed
            row.error = "QSAR queue unavailable"
            db.commit()
    return job_view(row)
