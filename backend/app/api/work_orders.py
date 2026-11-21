"""Project-scoped handoff inbox, human decisions, and read-only sharing."""

import json
from datetime import date, datetime, time, timedelta, timezone
from typing import Literal
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import Field
from sqlalchemy import JSON, cast, func, or_, select
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, get_current_user
from app.api.chat import ChatIn, chat
from app.db.session import get_db
from app.models.project import Project
from app.models.work_order import WorkOrder, WorkOrderReader
from app.schemas.work_order import Input, OrderAction, OrderRequest
from app.services.work_orders import dispatch, record

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
    command = body.model_dump(mode="json")
    for event in row.events:
        previous = event.get("command")
        if previous and previous["id"] == str(body.id):
            if previous != command:
                raise HTTPException(409, "รหัสคำสั่งซ้ำกับคำขออื่น")
            return output(row)
    if body.version != row.request["candidate"]["version"] or body.expected_sequence != len(row.events):
        raise HTTPException(409, "ข้อมูลเปลี่ยนแล้ว โหลดใบงานล่าสุดก่อน")
    if body.action == "recheck" and row.state == "needs_evidence":
        record(row, "head", "director", body.note, actor=user.id, command=command)
        dispatch(db, row)
    elif body.action == "reject" and row.state in {"awaiting_approval", "needs_evidence"}:
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
        for event in row.events:
            if event.get("advice_id") == str(body.id):
                if event["sender"] != body.role or event["source_sequence"] != body.expected_sequence:
                    raise HTTPException(409, "รหัสคำขอซ้ำ")
                return row, True
        if len(row.events) != body.expected_sequence:
            raise HTTPException(409, "ข้อมูลเปลี่ยนแล้ว โหลดใบงานล่าสุดก่อน")
        return row, False

    row, existing = current()
    if existing:
        return output(row)
    latest = {e["sender"]: e for e in row.events if "tool" in e}
    handoff = [e for e in latest.values() if body.role in (e["sender"], e["recipient"])]
    context = json.dumps(
        {
            "role": body.role,
            "brief": row.request["brief"],
            "version": row.request["candidate"]["version"],
            "state": row.state,
            "handoff": handoff,
        },
        ensure_ascii=False,
    )
    if len(context) > 18000:
        raise HTTPException(422, "ข้อมูลในใบงานนี้เกินขนาดที่ส่งให้โมเดลได้")
    db.rollback()  # Release the project lock while waiting for the provider.
    reply = await chat(
        ChatIn(
            surface="lab",
            context=context,
            question="สรุปใบงานตามบทบาทของคุณจากหลักฐานที่ให้มา บอกข้อจำกัดและสิ่งที่ผู้รับควรตรวจต่อ ห้ามอนุมัติรุ่นสูตร",
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
