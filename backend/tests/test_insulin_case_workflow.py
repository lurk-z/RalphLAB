"""Project-scoped research case, from intake to read-only replay of approved evidence."""

from uuid import uuid4

from app.core.auth import CurrentUser
from tests.test_studies import STUDIES, decision, start, submit
from tests.test_work_orders import BASE, lab


CASE = "insulin-lispro-v1"
PHASES = ["structures", "interface", "absorption", "conclusion"]


def run_command(row):
    return {"id": str(uuid4()), "expected_sequence": len(row["events"])}


def test_case_intake_is_explicit_and_preserves_legacy_discovery_orders(lab):
    client, _ = lab
    payload = {
        "id": str(uuid4()),
        "discipline": "discovery",
        "brief": "Compare insulin evidence",
    }
    legacy = client.post(STUDIES, json=payload).json()
    assert legacy["state"] == "in_progress"
    assert "case_template" not in legacy["request"]
    assert "case_template" not in legacy["events"][0]["intake"]
    assert (
        client.post(STUDIES, json={**payload, "case_template": None}).json() == legacy
    )
    assert (
        client.post(STUDIES, json={**payload, "case_template": CASE}).status_code == 409
    )
    assert (
        client.post(
            BASE + "/" + legacy["id"] + "/insulin-comparisons", json=run_command(legacy)
        ).status_code
        == 409
    )

    payload = {**payload, "id": str(uuid4()), "case_template": CASE}
    assert (
        client.post(STUDIES, json={**payload, "discipline": "trace"}).status_code == 422
    )
    case = client.post(STUDIES, json=payload).json()
    assert case["request"]["case_template"] == CASE
    assert client.post(STUDIES, json=payload).json() == case
    assert [s["id"] for s in case["stages"]] == PHASES
    assert (
        client.post(STUDIES, json={**payload, "case_template": None}).status_code == 409
    )


def test_published_evidence_flows_into_an_approved_replayable_report(lab):
    client, _ = lab
    row = start(client, "discovery", case_template=CASE)
    path = BASE + "/" + row["id"]
    endpoint = path + "/insulin-comparisons"
    public = client.get("/api/lab/protein/comparisons/" + CASE)
    assert public.status_code == 200
    geometry, expected_report = public.json()["structures"], public.json()["report"]
    assert [s["pdb"] for s in geometry] == ["1TRZ", "1LPH"]
    assert all(
        len(s["trace"]) == 102 and len(s["site_distances"]) == 2 for s in geometry
    )
    assert [len(s["contacts"]) for s in geometry] == [12, 8]
    assert (
        client.post(path + "/actions", json=decision(row, "approve")).status_code == 409
    )

    # The stage requires a published comparison. A manual laboratory result and the
    # unrelated protein alignment or pose commands cannot complete it.
    pose = {**run_command(row), "model": "3I40-AB-v1"}
    assert client.post(path + "/protein-runs", json=pose).status_code == 409
    assert (
        client.post(
            path + "/protein-poses", json={**pose, "angles": [0, 0]}
        ).status_code
        == 409
    )
    step = row["stages"][0]
    assert (
        client.post(
            path + "/stages/structures/results", json=submit(row, step)
        ).status_code
        == 409
    )
    assert client.get(path).json() == row

    run = run_command(row)
    assert (
        client.post(
            endpoint, json={**run, "expected_sequence": run["expected_sequence"] + 1}
        ).status_code
        == 409
    )
    saved = client.post(endpoint, json=run).json()
    assert saved["state"] == "awaiting_approval"
    assert saved["report"] is None
    records = saved["events"][len(row["events"]) :]
    assert [e["stage_id"] for e in records] == PHASES
    assert [e["sender"] for e in records] == [
        "researcher",
        "formulator",
        "analyst",
        "evaluator",
    ]
    assert [e["comparison_step"]["phase"] for e in records] == PHASES
    for event in records:
        assert event["comparison_step"]["run_id"] == run["id"]
        assert event["comparison_step"]["version"] == CASE
        assert event["comparison_step"]["sources"]
        assert not ({"result", "measurements", "statistics", "pose"} & event.keys())
    assert all(s["status"] == "complete" for s in saved["stages"])
    assert [e["comparison_report"] for e in records if "comparison_report" in e] == [
        expected_report
    ]
    assert expected_report["evidence"]["source"]["doi"] == "10.2337/diab.43.3.396"
    metrics = {
        m["id"]: (m["lispro"], m["regular"])
        for m in expected_report["evidence"]["metrics"]
    }
    assert metrics["tmax"] == (42, 101) and metrics["cmax"] == (698, 308)
    assert client.post(endpoint, json=run).json() == saved
    assert client.post(endpoint, json=run_command(saved)).status_code == 409

    approve = decision(saved, "approve")
    closed = client.post(path + "/actions", json=approve).json()
    assert (
        closed["report"]["decision"] == "approved"
        and closed["report"]["actor"] == "head"
    )
    assert closed["report"]["records"] == records
    assert closed["report"]["open_questions"] == []
    assert client.post(path + "/actions", json=approve).json() == closed
    assert client.post(endpoint, json=run).json() == closed
    assert client.post(endpoint, json=run_command(closed)).status_code == 409
    assert client.get(path).json() == closed


def test_only_owner_can_run_and_approve_case_and_readers_can_reopen(lab):
    client, identity = lab
    row = start(client, "discovery", case_template=CASE)
    path = BASE + "/" + row["id"]
    cmd = run_command(row)
    email = "reader@example.com"
    client.put("/api/lab/projects/1/readers", json={"email": email})
    reader, owner = CurrentUser("reader", email, email), identity[0]
    identity[0] = reader
    assert client.get(path).json() == row
    assert client.post(path + "/insulin-comparisons", json=cmd).status_code == 403
    identity[0] = CurrentUser("outside")
    assert client.get(path).status_code == 404
    assert client.post(path + "/insulin-comparisons", json=cmd).status_code == 404
    identity[0] = owner
    saved = client.post(path + "/insulin-comparisons", json=cmd).json()
    approval = decision(saved, "approve")
    identity[0] = reader
    assert client.post(path + "/insulin-comparisons", json=cmd).status_code == 403
    assert client.post(path + "/actions", json=approval).status_code == 403
    identity[0] = owner
    closed = client.post(path + "/actions", json=approval).json()
    identity[0] = reader
    assert client.get(path).json() == closed and closed["report"]["records"]
