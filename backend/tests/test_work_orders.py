"""Real API lifecycle on an isolated database, including replay and authorization."""

from copy import deepcopy
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.auth import CurrentUser, get_current_user
from app.db.session import get_db
from app.main import app
from app.models import ExperimentalEvidence, IngredientRegistry, Project, WorkOrder, WorkOrderReader


@compiles(JSONB, "sqlite")
def sqlite_json(element, compiler, **kw):
    return "JSON"


@pytest.fixture
def lab():
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    tables = [
        m.__table__
        for m in (Project, IngredientRegistry, ExperimentalEvidence, WorkOrder, WorkOrderReader)
    ]
    Project.metadata.create_all(engine, tables=tables)
    with Session(engine) as db:
        db.add(Project(id=1, name="QA", owner_id="head"))
        db.add(
            IngredientRegistry(
                normalized_name="aqua",
                canonical_name="Water",
                verification_status="verified",
                canonical_smiles="O",
                pubchem_cid=962,
            )
        )
        db.commit()

    def session():
        with Session(engine) as db:
            yield db

    identity = [CurrentUser("head")]
    old = app.dependency_overrides.copy()
    app.dependency_overrides[get_current_user] = lambda: identity[0]
    app.dependency_overrides[get_db] = session
    try:
        with TestClient(app) as client:
            yield client, identity
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(old)
        engine.dispose()


BASE = "/api/lab/projects/1/orders"


def request():
    items = [{"name": "Water", "percent": "100"}]
    return {
        "id": str(uuid4()),
        "brief": "ตรวจชนิดสาร",
        "baseline": {"version": "V1", "ingredients": items},
        "candidate": {"version": "V2", "ingredients": items},
        "locked": ["Aqua"],
    }


def command(order, action):
    return {
        "id": str(uuid4()),
        "action": action,
        "version": "V2",
        "expected_sequence": len(order["events"]),
        "note": "ตรวจทานแล้ว",
    }


def test_real_handoff_and_exactly_once_decision(lab):
    client, _ = lab
    body = request()
    row = client.post(BASE, json=body).json()
    assert row["state"] == "awaiting_approval"
    assert [e["sender"] for e in row["events"]] == [
        "head",
        "director",
        "researcher",
        "formulator",
        "analyst",
        "evaluator",
    ]
    assert client.post(BASE, json=body).json() == row
    assert client.post(BASE, json={**body, "brief": "different"}).status_code == 409
    assert row["events"][2]["citations"][0]["pubchem"].endswith("/962")
    path = BASE + "/" + row["id"] + "/actions"
    approve = command(row, "approve")
    assert client.post(path, json={**approve, "version": "V3"}).status_code == 409
    saved = client.post(path, json=approve).json()
    assert saved["state"] == "approved"
    assert saved["events"][-1]["actor"] == "head"
    assert client.post(path, json=approve).json() == saved
    assert client.post(path, json=command(saved, "reject")).status_code == 409
    assert client.get(BASE).json()[0] == saved


def test_pause_and_recheck_for_missing_endpoint_evidence(lab):
    client, _ = lab
    row = client.post(BASE, json={**request(), "endpoint": "skin"}).json()
    assert row["state"] == "needs_evidence"
    path = BASE + "/" + row["id"] + "/actions"
    assert client.post(path, json=command(row, "approve")).status_code == 409
    recheck = command(row, "recheck")
    again = client.post(path, json=recheck).json()
    assert again["state"] == "needs_evidence"
    assert len(again["events"]) > len(row["events"])
    assert client.post(path, json=recheck).json() == again
    assert client.post(path, json=command(again, "reject")).json()["state"] == "rejected"


def test_team_read_is_scoped_verified_and_revocable(lab):
    client, identity = lab
    row = client.post(BASE, json=request()).json()
    grants = "/api/lab/projects/1/readers"
    email = {"email": "reader@example.com"}
    assert client.put(grants, json=email).status_code == 204
    identity[0] = CurrentUser("other", email["email"])
    assert client.get(BASE).status_code == 404
    identity[0] = CurrentUser("other", email["email"], email["email"])
    assert client.get(BASE).json()[0]["id"] == row["id"]
    assert client.get("/api/projects/1").status_code == 404
    assert client.post(BASE, json=request()).status_code == 403
    assert (
        client.post(BASE + "/" + row["id"] + "/actions", json=command(row, "approve")).status_code == 403
    )
    identity[0] = CurrentUser("head")
    assert client.request("DELETE", grants, json=email).status_code == 204
    identity[0] = CurrentUser("other", email["email"], email["email"])
    assert client.get(BASE).status_code == 404


def test_invalid_formula_and_locked_changes(lab):
    client, _ = lab
    body = deepcopy(request())
    body["candidate"]["ingredients"] = [{"name": "Water", "percent": "70"}]
    assert client.post(BASE, json=body).status_code == 422
    body["candidate"]["ingredients"].append({"name": "Unknown", "percent": "30"})
    row = client.post(BASE, json=body).json()
    assert row["state"] == "needs_evidence"
    assert row["events"][-1]["locked_changes"] == ["aqua"]


def test_role_advice_receives_own_evidence_and_cannot_approve(lab, monkeypatch):
    from fastapi import HTTPException
    from app.api.chat import ChatOut
    from app.api import work_orders

    client, _ = lab
    row = client.post(BASE, json=request()).json()
    path = BASE + "/" + row["id"] + "/advice"
    command = {"id": str(uuid4()), "role": "researcher", "expected_sequence": len(row["events"])}

    async def offline(body):
        raise HTTPException(503, "offline")

    monkeypatch.setattr(work_orders, "chat", offline)
    assert client.post(path, json=command).status_code == 503
    assert client.get(BASE).json()[0] == row
    calls = []

    async def reply(body):
        assert body.surface == "lab" and "/compound/962" in body.context
        calls.append(body)
        return ChatOut(answer="ทดสอบเอกลักษณ์สาร")

    monkeypatch.setattr(work_orders, "chat", reply)
    advised = client.post(path, json=command).json()
    assert advised["events"][-1]["sender"] == "researcher"
    assert advised["state"] == "awaiting_approval"
    assert client.post(path, json=command).json() == advised
    assert len(calls) == 1

def test_line_report_uses_bangkok_activity_and_same_case_id(lab, monkeypatch):
    from datetime import datetime, timezone
    from app.services import work_orders as events
    client, identity = lab
    class Clock(datetime):
        at = datetime(2026, 11, 20, 16, 59, 59, tzinfo=timezone.utc)
        @classmethod
        def now(cls, tz=None):
            return cls.at
    monkeypatch.setattr(events, "datetime", Clock)
    order = client.post(BASE, json=request()).json()
    url = BASE + "/" + order["id"]
    assert client.get(url).json() == order
    assert client.get(BASE, params={"activity_date": "2026-11-21"}).json() == []
    Clock.at = datetime(2026, 11, 20, 17, tzinfo=timezone.utc)
    approved = client.post(url+"/actions", json=command(order,"approve")).json()
    for day in ("2026-11-20","2026-11-21"):
        assert client.get(BASE, params={"activity_date":day}).json() == [approved]
    assert client.get(BASE, params={"activity_date":"2026-11-22"}).json() == []
    identity[0] = CurrentUser("outside")
    assert client.get(url).status_code == 404
    assert client.get(BASE,params={"activity_date":"2026-11-21"}).status_code == 404
