"""Exercise the HTTP entry points, immutable sources, physical-data gates, and model replay."""

from datetime import date, timedelta
from uuid import uuid4

import json
import pytest
from app.core.auth import CurrentUser
from app.services.studies import today
from tests.test_work_orders import BASE, lab, request


STUDIES = BASE.removesuffix("orders") + "studies"
BRIEFS = BASE.removesuffix("orders") + "briefs"


def test_agent_summary_records_only_evidence_supplied_for_selected_stage(
    lab, monkeypatch
):
    from app.api import work_orders
    from app.api.chat import ChatOut

    client, _ = lab
    row = start(client, "validation")
    path = BASE + "/" + row["id"] + "/advice"
    cmd = {
        "id": str(uuid4()),
        "stage_id": "plan",
        "role": "director",
        "expected_sequence": len(row["events"]),
    }
    calls = []

    async def answer(body):
        packet = json.loads(body.context)
        assert (
            packet["sources"][0]["title"].startswith("ICH Q2")
            and packet["last_observation"] is None
        )
        calls.append(packet)
        return ChatOut(answer="QA summary")

    monkeypatch.setattr(work_orders, "chat", answer)
    assert client.post(path, json={**cmd, "role": "analyst"}).status_code == 422
    new = client.post(path, json=cmd).json()
    assert new["state"] == row["state"] and new["stages"] == row["stages"]
    assert new["events"][-1]["sources_sent"] == calls[0]["sources"]
    assert client.post(path, json=cmd).json() == new and len(calls) == 1


def start(client, discipline, **options):
    payload = {
        "id": str(uuid4()),
        "brief": "QA test records",
        "discipline": discipline,
        **options,
    }
    row = client.post(STUDIES, json=payload)
    assert row.status_code == 200, row.text
    assert client.post(STUDIES, json=payload).json() == row.json()
    return row.json()


def submit(row, step, **changes):
    return {
        "id": str(uuid4()),
        "expected_sequence": len(row["events"]),
        "disposition": "record",
        "observed_on": today().isoformat(),
        "finding": "QA fixture",
        "evidence": "DEMO-LAB-41",
        "measurements": [2, 4] if step["minimum_values"] else [],
        "unit": "mg" if step["minimum_values"] else None,
        **changes,
    }


def decision(row, action):
    return {
        "id": str(uuid4()),
        "expected_sequence": len(row["events"]),
        "version": "R1",
        "action": action,
        "note": "QA decision",
    }


@pytest.mark.parametrize(
    "discipline",
    ["discovery", "trace", "validation", "scale_up", "synthesis", "stability"],
)
def test_study_closes_with_source_and_lab_record_for_each_step(lab, discipline):
    client, _ = lab
    row = start(
        client,
        discipline,
        start_date="2020-01-31",
        parallel=discipline == "synthesis",
        reaction_steps=30,
    )
    url = BASE + "/" + row["id"]
    assert row["state"] == "in_progress"
    assert (
        client.post(url + "/actions", json=decision(row, "approve")).status_code == 409
    )
    if discipline == "synthesis":
        assert len(row["stages"]) == 30 and row["stages"][-1]["depends_on"] == [
            "S28",
            "S29",
        ]
    downstream = next((s for s in row["stages"] if s["depends_on"]), None)
    if downstream:
        assert (
            client.post(
                url + "/stages/" + downstream["id"] + "/results",
                json=submit(row, downstream),
            ).status_code
            == 409
        )
    for step in row["stages"]:
        path = url + "/stages/" + step["id"] + "/results"
        payload = submit(row, step)
        saved = client.post(path, json=payload)
        assert saved.status_code == 200, saved.text
        row = saved.json()
        assert client.post(path, json=payload).json() == row
        event = row["events"][-1]
        assert (
            event["source"] == step["source"]
            and event["result"]["evidence"] == "DEMO-LAB-41"
        )
        assert event["source"]["url"].startswith("https://")
        if step["minimum_values"]:
            assert event["statistics"]["mean"] == 3 and event["statistics"][
                "sd"
            ] == pytest.approx(2**0.5)
    assert row["state"] == "awaiting_approval"
    cmd = decision(row, "approve")
    closed = client.post(url + "/actions", json=cmd).json()
    assert (
        closed
        == client.post(url + "/actions", json=cmd).json()
        == client.get(url).json()
    )
    assert (
        closed["report"]["actor"] == "head" and not closed["report"]["open_questions"]
    )
    assert len(closed["report"]["records"]) == len(row["stages"])
    assert client.post(path, json=submit(closed, step)).status_code == 409


def test_calendar_holds_require_dated_evidence(lab):
    client, _ = lab
    row = start(client, "stability", start_date="2024-01-31", months=[0, 1, 119])
    assert [s["due"] for s in row["stages"]] == [
        "2024-01-31",
        "2024-02-29",
        "2033-12-31",
    ]
    path = BASE + "/" + row["id"] + "/stages/"
    step = row["stages"][0]
    assert (
        client.post(
            path + "M0/results", json=submit(row, step, observed_on="2024-01-30")
        ).status_code
        == 422
    )
    assert (
        client.post(
            path + "M0/results",
            json=submit(
                row, step, observed_on=(today() + timedelta(days=1)).isoformat()
            ),
        ).status_code
        == 422
    )
    assert (
        client.post(
            path + "M0/results", json=submit(row, step, evidence=" ")
        ).status_code
        == 422
    )
    assert (
        client.post(
            path + "M0/results", json=submit(row, step, measurements=[], unit=None)
        ).status_code
        == 422
    )
    if today() < date(2033, 12, 31):
        assert (
            client.post(path + "M119/results", json=submit(row, step)).status_code
            == 409
        )
    extra = {
        "title": "QA reference",
        "url": "https://example.org/paper",
        "locator": "Figure 2",
        "application": "QA interpretation",
    }
    held = submit(
        row, step, disposition="hold", literature=[extra], measurements=[], unit=None
    )
    row = client.post(path + "M0/results", json=held).json()
    assert row["stages"][0]["status"] == "ready" and row["events"][-1]["result"][
        "literature"
    ] == [extra]
    row = client.post(path + "M0/results", json=submit(row, step)).json()
    assert row["stages"][0]["status"] == "complete"
    closed = client.post(
        BASE + "/" + row["id"] + "/actions", json=decision(row, "reject")
    ).json()
    assert closed["report"]["open_questions"] and len(closed["report"]["records"]) == 2


def test_model_is_reproducible_annotation_and_reader_cannot_write(lab):
    client, identity = lab
    meta = client.get("/api/lab/protein/gfp").json()
    assert meta["pdb"] == "1EMA" and len(meta["trace"]) == 221
    row = start(client, "discovery")
    url = BASE + "/" + row["id"] + "/protein-poses"

    def pose(row, angles):
        return {
            "id": str(uuid4()),
            "model": meta["model"],
            "angles": angles,
            "expected_sequence": len(row["events"]),
        }

    baseline = pose(row, [0, 0])
    saved = client.post(url, json=baseline).json()
    assert saved["events"][-1]["pose"]["rmsd"] == 0 and saved["stages"] == row["stages"]
    assert client.post(url, json=baseline).json() == saved
    assert client.post(url, json={**baseline, "angles": [1, 0]}).status_code == 409
    row = client.post(url, json=pose(saved, meta["start_angles"])).json()
    assert row["events"][-1]["pose"]["rmsd"] > 1 and row["state"] == "in_progress"
    assert client.post(url, json=pose(row, [999, 0])).status_code == 422
    grants = "/api/lab/projects/1/readers"
    email = "team@example.com"
    client.put(grants, json={"email": email})
    identity[0] = CurrentUser("reader", email, email)
    assert client.get(BASE + "/" + row["id"]).json() == row
    assert client.post(url, json=pose(row, [12, 12])).status_code == 403


def test_formula_brief_continues_under_same_id_and_reports(lab):
    client, _ = lab
    body = request()
    brief = {"id": body["id"], "brief": body["brief"], "source": "attach"}
    row = client.post(BRIEFS, json=brief).json()
    assert row["state"] == "awaiting_inputs" and row["report"] is None
    row = client.post(BASE, json=body).json()
    assert row["state"] == "awaiting_approval" and row["id"] == brief["id"]
    assert client.post(BRIEFS, json=brief).json() == row
    cmd = {**decision(row, "approve"), "version": "V2"}
    closed = client.post(BASE + "/" + row["id"] + "/actions", json=cmd).json()
    assert closed["report"]["citations"][0]["pubchem"].endswith("/962")
    assert all(e["application"] for e in closed["events"] if "tool" in e)


def test_insulin_brief_uses_matching_structure_and_saves_reference_frame(lab):
    client, _ = lab
    data = client.get("/api/lab/protein/insulin").json()
    assert [sum(r["chain"] == c for r in data["trace"]) for c in "AB"] == [21, 30]
    row = start(client, "discovery", brief="QA โครงสร้างอินซูลิน")
    hit = row["events"][-1]["structure"]
    assert hit["pdb"] == "3I40" and hit["observed_positions"] == 51
    url = BASE + "/" + row["id"] + "/protein-poses"
    for angles, target in [([65, -80], 9.196), ([0, 0], 0)]:
        row = client.post(
            url,
            json={
                "id": str(uuid4()),
                "model": data["model"],
                "angles": angles,
                "expected_sequence": len(row["events"]),
            },
        ).json()
        pose = row["events"][-1]["pose"]
        assert pose["source_url"] == hit["url"] and pose["rmsd"] == target
    closed = client.post(
        BASE + "/" + row["id"] + "/actions", json=decision(row, "reject")
    ).json()
    assert len(closed["report"]["open_questions"]) == 3
    assert closed["report"]["records"][0]["structure"] == hit


@pytest.mark.parametrize("slug", ["insulin", "gfp"])
def test_protein_table_runs_persist_scoped_reproducible_frames(lab, slug):
    client, identity = lab
    model = client.get("/api/lab/protein/" + slug).json()
    row = start(client, "discovery")
    path = BASE + "/" + row["id"]
    url = path + "/protein-runs"

    def run(row, **changes):
        return {
            "id": str(uuid4()),
            "expected_sequence": len(row["events"]),
            "model": model["model"],
            **changes,
        }

    # A saved pose for the other version must never become the input geometry.
    other = "3I40-AB-v1" if slug == "gfp" else "1EMA-A-17-28-v1"
    row = client.post(
        path + "/protein-poses", json=run(row, model=other, angles=[0, 0])
    ).json()
    first = run(row)
    saved = client.post(url, json=first).json()
    assert client.get(path).json() == client.post(url, json=first).json() == saved
    assert saved["state"] == row["state"] and saved["stages"] == row["stages"]
    new_events = saved["events"][len(row["events"]) :]
    assert [e["sender"] for e in new_events] == [
        "researcher",
        "formulator",
        "formulator",
        "analyst",
    ]
    frames = [e["protein_step"] for e in new_events]
    assert [f["phase"] for f in frames] == ["inspect", "adjust", "align", "verify"]
    assert all(
        f["run_id"] == first["id"]
        and f["model"] == model["model"]
        and f["source_url"] == model["source_url"]
        for f in frames
    )
    assert (
        frames[0]["angles"] == model["start_angles"]
        and frames[0]["input_pose_event_id"] is None
    )
    assert (
        frames[0]["rmsd"]
        > frames[1]["rmsd"]
        > frames[2]["rmsd"]
        == frames[3]["rmsd"]
        == 0
    )
    assert new_events[-1]["pose"]["angles"] == [0, 0]
    assert client.post(url, json={**first, "start_from": "exercise"}).status_code == 409
    assert client.post(url, json=run(row)).status_code == 409
    assert client.post(url, json=run(saved, task="unrecognized")).status_code == 422

    custom = client.post(
        path + "/protein-poses", json=run(saved, angles=[-71, 119])
    ).json()
    assert client.post(url, json=first).json() == custom
    continued = client.post(url, json=run(custom)).json()
    origin = continued["events"][-4]["protein_step"]
    assert origin["input_pose_event_id"] == custom["events"][-1]["id"] and origin[
        "angles"
    ] == [-71, 119]
    reset = client.post(url, json=run(continued, start_from="exercise")).json()
    assert reset["events"][-4]["protein_step"]["angles"] == model["start_angles"]
    assert reset["events"][-4]["protein_step"]["input_pose_event_id"] is None
    closed = client.post(path + "/actions", json=decision(reset, "reject")).json()
    assert len([e for e in closed["report"]["records"] if "protein_step" in e]) == 12
    assert client.post(url, json=first).json() == closed
    assert client.post(url, json=run(closed)).status_code == 409
    another = start(client, "trace")
    assert (
        client.post(
            BASE + "/" + another["id"] + "/protein-runs", json=run(another)
        ).status_code
        == 409
    )

    email = "team@example.com"
    client.put("/api/lab/projects/1/readers", json={"email": email})
    identity[0] = CurrentUser("reader", email, email)
    assert client.get(path).json() == closed
    assert client.post(url, json=first).status_code == 403
    identity[0] = CurrentUser("other")
    assert client.post(url, json=first).status_code == 404
