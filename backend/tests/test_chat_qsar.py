from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.chat_qsar import assessment_service
from app.core.auth import CurrentUser, get_current_user
from app.core.config import settings
from app.db.session import get_db
from app.main import app
from app.models import Assessment, AssessmentStatus, IngredientRegistry, Project


@compiles(JSONB, "sqlite")
def json_as_sqlite(element, compiler, **kw):
    return "JSON"


def test_chat_qsar_creation_read_replay_and_scope(monkeypatch):
    db_engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Project.metadata.create_all(db_engine, tables=[m.__table__ for m in (Project, IngredientRegistry, Assessment)])
    who = [CurrentUser("qa")]
    with Session(db_engine) as db:
        db.add_all([Project(id=i, name=f"Project {i}", owner_id=who[0].id) for i in (1, 2)])
        for cid, name, structure in [(962, "Water", "O"), (753, "Glycerin", "OCC(O)CO")]:
            db.add(IngredientRegistry(normalized_name=name.lower(), canonical_name=name, pubchem_cid=cid,
                                      canonical_smiles=structure, verification_status="verified", qsar_eligible=cid != 962))
        db.commit()

    def session():
        with Session(db_engine) as db:
            yield db

    sent = []
    monkeypatch.setattr(settings, "ASSESSMENT_EXECUTION_MODE", "queue")
    monkeypatch.setattr(assessment_service, "enqueue_assessment", sent.append)
    original = app.dependency_overrides.copy()
    app.dependency_overrides[get_db] = session
    app.dependency_overrides[get_current_user] = lambda: who[0]
    job_id = str(uuid4())
    base = "/api/lab/projects/1/chat-qsar"
    body = {"id": job_id, "region": "face", "ingredients": [{"cid": 753, "percent": 5}, {"cid": 962, "percent": 95}]}
    try:
        with TestClient(app) as client:
            assert client.get(base + "?job=latest").json() is None
            for _ in range(2):
                response = client.post(base, json=body)
                assert response.status_code == 200, response.text
                assert response.json()["id"] == job_id and response.json()["state"] == "queued"
            assert sent == [job_id]
            assert client.post(base, json={**body, "region": "hand"}).status_code == 409
            assert client.post(base, json={**body, "ingredients": [{"cid": 962, "percent": 100}]}).status_code == 422
            assert client.get(base.replace("/1/", "/2/") + "?job=" + job_id).status_code == 404
            with Session(db_engine) as db:
                row = db.get(Assessment, job_id)
                row.status = AssessmentStatus.completed
                row.result = {"endpoints": {"skin": {"peak_score": 0.18, "confidence": {"level": "High", "in_domain": True}}}}
                db.commit()
            assert client.get(base + "?job=latest").json()["result"]["endpoints"]["skin"]["peak_score"] == 0.18
            who[0] = CurrentUser("other")
            assert client.get(base + "?job=" + job_id).status_code == 404
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(original)
        db_engine.dispose()
