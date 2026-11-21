"""Compare two deposited insulin TR dimers, using their observed coordinates."""

from itertools import product
import json
from math import dist
from pathlib import Path

import numpy as np


REFERENCE, MOBILE = "1TRZ", "1LPH"
CUTOFF = 4.5
SITE_PAIRS = [(28, 23), (23, 28)]
PAPERS = {
    REFERENCE: ("Regular human insulin", 1.60, "https://doi.org/10.1021/bi00172a030"),
    MOBILE: ("Insulin lispro", 2.30, "https://doi.org/10.1016/S0969-2126(01)00195-2"),
}


def fit_core(reference, mobile):
    """Match the dimer backbone outside the inspected B/D C-terminal segment."""

    def core(rows):
        return {
            (chain, number): xyz
            for chain, number, _, atom, *xyz in rows
            if atom == "CA" and (chain in ("A", "C") or number < 23)
        }

    fixed, moving = core(reference), core(mobile)
    keys = sorted(fixed.keys() & moving.keys())
    target = np.array([fixed[key] for key in keys])
    points = np.array([moving[key] for key in keys])
    a, b = points - points.mean(axis=0), target - target.mean(axis=0)
    u, _, vt = np.linalg.svd(a.T @ b)
    # Exclude mirror solutions; a protein can only undergo a proper rigid rotation.
    if np.linalg.det(u @ vt) < 0:
        u[:, -1] *= -1
    rotation = u @ vt
    shift = target.mean(axis=0) - points.mean(axis=0) @ rotation
    rmsd = np.sqrt(np.mean(np.sum((a @ rotation - b) ** 2, axis=1)))
    return rotation, shift, len(keys), round(float(rmsd), 3)


def specimen(pdb, entry, rotation, shift):
    trace = []
    tips = {"B": {}, "D": {}}
    for chain, number, name, atom, *original in entry["atoms"]:
        xyz = np.round(np.asarray(original) @ rotation + shift, 6).tolist()
        residue = {"chain": chain, "number": number, "name": name, "xyz": xyz}
        if atom == "CA":
            trace.append(residue)
        if chain in tips and 23 <= number <= 30:
            tips[chain].setdefault(number, []).append({**residue, "atom": atom})

    contacts, distances = [], {}
    for left_number, right_number in product(sorted(tips["B"]), sorted(tips["D"])):
        candidates = product(tips["B"][left_number], tips["D"][right_number])
        left, right = min(
            candidates, key=lambda pair: dist(pair[0]["xyz"], pair[1]["xyz"])
        )
        distance = dist(left["xyz"], right["xyz"])
        pair = {"left": left, "right": right, "distance_angstrom": round(distance, 3)}
        distances[left_number, right_number] = pair
        if distance <= CUTOFF:
            contacts.append(pair)

    title, resolution, paper = PAPERS[pdb]
    return {
        "pdb": pdb,
        "title": title,
        "resolution_angstrom": resolution,
        "source_url": f"https://www.rcsb.org/structure/{pdb}",
        "paper_url": paper,
        "coordinates_url": entry["coordinates_url"],
        "coordinates_sha256": entry["sha256"],
        "assembly_id": 3,
        "trace": trace,
        "contacts": contacts,
        "site_distances": [distances[key] for key in SITE_PAIRS],
    }


def compare():
    data = json.loads(
        Path(__file__)
        .with_name("insulin_interface_atoms.json")
        .read_text(encoding="utf8")
    )
    rotation, shift, count, rmsd = fit_core(
        data[REFERENCE]["atoms"], data[MOBILE]["atoms"]
    )
    return {
        "structures": [
            specimen(REFERENCE, data[REFERENCE], np.eye(3), np.zeros(3)),
            specimen(MOBILE, data[MOBILE], rotation, shift),
        ],
        "alignment": {
            "reference_pdb": REFERENCE,
            "mobile_pdb": MOBILE,
            "method": "Kabsch บน Cα ของ A/C ตำแหน่ง 1–21 และ B/D ตำแหน่ง 1–22 เทียบกันทั้งไดเมอร์",
            "atom_count": count,
            "rmsd_angstrom": rmsd,
        },
        "cutoff_angstrom": CUTOFF,
        "contact_rule": "นับคู่ตำแหน่ง B23–30 กับ D23–30 คู่ละหนึ่งครั้ง เมื่ออะตอมหนักที่ใกล้ที่สุดอยู่ห่างกัน ≤ 4.5 Å",
        "interface_note": "A+B และ C+D คืออินซูลินคนละโมเลกุล ภาพแสดงคู่ที่อยู่ในหน่วยอสมมาตรของผลึก ซึ่งเป็นส่วนหนึ่งของเฮกซะเมอร์ใน assembly 3",
        "limitations": "ระยะคำนวณจากอะตอมที่มีพิกัดและ occupancy มากกว่าศูนย์ ใช้ตำแหน่งหลักหรือ conformer A บางหมู่ข้างมีข้อมูลไม่ครบ ผลขึ้นกับสภาวะผลึกและเกณฑ์ระยะ การประเมินการจับกลุ่มในสารละลายหรือการดูดซึมต้องอาศัยข้อมูลการวัดเพิ่มเติม",
    }


STRUCTURE_COMPARISON = compare()
