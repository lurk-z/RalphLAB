"""Reference-frame geometry exercises using deposited alpha-carbon coordinates."""

import json
from math import radians, cos, sin
from pathlib import Path
from typing import Annotated, Literal
from uuid import UUID

import numpy as np
from pydantic import Field
from app.schemas.work_order import Input


ModelId = Literal["1EMA-A-17-28-v1", "3I40-AB-v1"]


class ProteinPose(Input):
    id: UUID
    expected_sequence: int = Field(ge=1)
    model: ModelId
    angles: tuple[
        Annotated[int, Field(ge=-180, le=180)], Annotated[int, Field(ge=-180, le=180)]
    ]


class ProteinRun(Input):
    id: UUID
    expected_sequence: int = Field(ge=1)
    model: ModelId
    task: Literal["align_reference"] = "align_reference"
    start_from: Literal["latest", "exercise"] = "latest"


TRACE = json.loads(Path(__file__).with_name("gfp_1ema.json").read_text(encoding="utf8"))
PROTEIN = dict(
    model="1EMA-A-17-28-v1",
    title="Green fluorescent protein",
    pdb="1EMA",
    chain="A",
    first=17,
    last=28,
    hinges=[3, 7],
    start_angles=[65, -80],
    source_url="https://www.rcsb.org/structure/1EMA",
    trace=TRACE,
    organism="Aequorea victoria",
)
INSULIN = dict(
    model="3I40-AB-v1",
    title="Human insulin",
    pdb="3I40",
    chain="A + B",
    organism="Homo sapiens",
    first=1,
    last=30,
    hinges=[],
    start_angles=[65, -80],
    source_url="https://www.rcsb.org/structure/3I40",
    trace=json.loads(
        Path(__file__).with_name("insulin_3i40.json").read_text(encoding="utf8")
    ),
)
MODELS = {m["model"]: m for m in (PROTEIN, INSULIN)}


def rotate(moved, axis, degrees):
    theta = radians(degrees)
    return (
        moved * cos(theta)
        + np.cross(axis, moved) * sin(theta)
        + np.outer(moved @ axis, axis) * (1 - cos(theta))
    )


def score(model, angles):
    data = MODELS[model]
    original = np.array(
        [
            r["xyz"]
            for r in data["trace"]
            if data["first"] <= r["number"] <= data["last"]
        ]
    )
    pose = original.copy()
    if model == INSULIN["model"]:
        moving = [r["chain"] == "B" for r in data["trace"]]
        center = pose[moving].mean(axis=0)
        for axis, degrees in zip(([1, 0, 0], [0, 1, 0]), angles):
            pose[moving] = center + rotate(
                pose[moving] - center, np.array(axis), degrees
            )
    for index, degrees in zip(data["hinges"], angles):
        pivot = pose[index]
        axis = pivot - pose[index - 1]
        axis /= np.linalg.norm(axis)
        moved = pose[index + 1 :] - pivot
        pose[index + 1 :] = pivot + rotate(moved, axis, degrees)
    return round(float(np.sqrt(np.mean(np.sum((pose - original) ** 2, axis=1)))), 3)


def alignment_frames(model, initial):
    """Restore the two known viewer rotations and measure the reference-frame RMSD."""
    first, second = initial
    # At large angles undoing a single joint can make the trace temporarily
    # farther away. Choose a measured intermediate and keep the input on a tie.
    candidates = [
        initial,
        (round(first / 2), round(second / 2)),
        (0, second),
        (first, 0),
    ]
    intermediate = min(candidates, key=lambda angles: score(model, angles))
    aligned = (0, 0)
    steps = [
        (
            "inspect",
            "researcher",
            "formulator",
            "อ่านพิกัดอ้างอิงและวัดระยะคลาดของท่าตั้งต้น",
            initial,
        ),
        (
            "adjust",
            "formulator",
            "formulator",
            "เปรียบเทียบการหมุนสองแกนและเลือกท่าระหว่างทางจากค่า RMSD",
            intermediate,
        ),
        ("align", "formulator", "analyst", "คืนมุมของแบบฝึกให้ตรงกับกรอบพิกัดอ้างอิง", aligned),
        (
            "verify",
            "analyst",
            "head",
            "คำนวณ RMSD ของท่าสุดท้ายและบันทึกผลเทียบพิกัด PDB",
            aligned,
        ),
    ]
    data = MODELS[model]
    for phase, sender, recipient, message, angles in steps:
        geometry = dict(
            model=model,
            pdb=data["pdb"],
            angles=list(angles),
            rmsd=score(model, angles),
            source_url=data["source_url"],
        )
        yield phase, sender, recipient, message, geometry
