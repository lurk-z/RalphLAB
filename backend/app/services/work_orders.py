"""Bounded role dispatch. Only a human can release a candidate snapshot."""

from datetime import datetime, timezone
from uuid import uuid4
from rdkit import Chem
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.ingredient_registry import ExperimentalEvidence, IngredientRegistry
from app.models.work_order import WorkOrder
from app.schemas.work_order import OrderRequest
from app.services.ingredient_registry import normalize_ingredient_name

TOOLS = {
    "director": ("Pydantic", "https://docs.pydantic.dev/latest/concepts/models/"),
    "researcher": ("PubChem / ทะเบียนสาร", "https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest"),
    "formulator": ("Decimal", "https://docs.python.org/3/library/decimal.html"),
    "analyst": ("RDKit", "https://www.rdkit.org/docs/GettingStartedInPython.html"),
    "evaluator": ("PostgreSQL", "https://www.postgresql.org/docs/current/explicit-locking.html"),
}


def record(order, sender, recipient, message, **details):
    event = dict(
        id=str(uuid4()),
        project_id=order.project_id,
        work_order_id=order.id,
        sequence=len(order.events) + 1,
        at=datetime.now(timezone.utc).isoformat(),
        sender=sender,
        recipient=recipient,
        version=order.request["candidate"]["version"],
        message=message,
        **details,
    )
    order.events = [*order.events, event]


def dispatch(db: Session, order: WorkOrder):
    request = OrderRequest.model_validate(order.request)
    before, after = (
        {normalize_ingredient_name(i.name): i.percent for i in rev.ingredients}
        for rev in (request.baseline, request.candidate)
    )
    names = sorted(before.keys() | after.keys())
    record(order, "director", "researcher", "ส่งใบงานตรวจหลักฐาน", tool=TOOLS["director"])
    rows = db.scalars(
        select(IngredientRegistry).where(IngredientRegistry.normalized_name.in_(names))
    ).all()
    registry = {row.normalized_name: row for row in rows}
    citations, gaps, structures = [], [], {}
    for name in names:
        row = registry.get(name)
        if not row or row.verification_status != "verified":
            gaps.append(f"{name}: ยังไม่ยืนยันชนิดสาร")
            continue
        item = {
            "ingredient": name,
            "record": row.id,
            "registry_version": row.registry_version,
            "pubchem": f"https://pubchem.ncbi.nlm.nih.gov/compound/{row.pubchem_cid}"
            if row.pubchem_cid
            else None,
        }
        if request.endpoint != "identity":
            evidence = db.scalars(
                select(ExperimentalEvidence)
                .where(
                    ExperimentalEvidence.ingredient_id == row.id,
                    ExperimentalEvidence.endpoint == request.endpoint,
                    ExperimentalEvidence.review_status.in_(["verified", "consensus_verified"]),
                )
                .order_by(ExperimentalEvidence.id)
            ).all()
            if not evidence:
                gaps.append(f"{name}: ขาดหลักฐานที่ตรวจทานสำหรับ {request.endpoint}")
            elif len({e.candidate_label for e in evidence}) > 1:
                gaps.append(f"{name}: หลักฐานสำหรับ {request.endpoint} ขัดแย้งกัน")
            item["evidence"] = [
                {
                    "id": e.id,
                    "source": e.source_name,
                    "review": e.review_status,
                    "reference": e.source_id,
                    "url": e.source_url,
                }
                for e in evidence[:5]
            ]
        citations.append(item)
        structures[name] = row.canonical_smiles
    record(
        order,
        "researcher",
        "formulator",
        "ส่งหลักฐานและรายการข้อมูลที่ขาด",
        tool=TOOLS["researcher"],
        citations=citations,
        gaps=list(gaps),
    )
    locked = {normalize_ingredient_name(n) for n in request.locked}
    changes = [
        {
            "name": n,
            "before": str(before.get(n, 0)),
            "after": str(after.get(n, 0)),
            "locked": n in locked,
        }
        for n in names
        if before.get(n) != after.get(n)
    ]
    record(
        order,
        "formulator",
        "analyst",
        "เปรียบเทียบสัดส่วนต้นทางกับรุ่นเสนอ",
        tool=TOOLS["formulator"],
        changes=changes,
    )
    parsed = []
    for name, smiles in structures.items():
        if not smiles:
            parsed.append({"name": name, "structure": "unavailable"})
        elif Chem.MolFromSmiles(smiles) is None:
            gaps.append(f"{name}: อ่านโครงสร้างในทะเบียนไม่ได้")
            parsed.append({"name": name, "structure": "invalid"})
        else:
            parsed.append({"name": name, "structure": "parsed"})
    record(
        order,
        "analyst",
        "evaluator",
        "ตรวจรูปแบบโครงสร้างที่มีในทะเบียน",
        tool=TOOLS["analyst"],
        structures=parsed,
    )
    order.state = "needs_evidence" if gaps else "awaiting_approval"
    message = "พักงานจนกว่าจะมีหลักฐานเพิ่ม" if gaps else "ส่งรุ่นเสนอให้เจ้าของโครงการตัดสินใจ"
    record(
        order,
        "evaluator",
        "head",
        message,
        tool=TOOLS["evaluator"],
        gaps=gaps,
        locked_changes=[c["name"] for c in changes if c["locked"]],
    )
