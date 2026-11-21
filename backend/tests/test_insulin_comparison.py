"""Regressions for the crystal dimer geometry displayed on the shared table."""

from math import dist, sqrt

import pytest

from app.services.insulin_comparison import STRUCTURE_COMPARISON


def test_displayed_dimers_share_the_reported_rigid_alignment():
    regular, lispro = STRUCTURE_COMPARISON["structures"]
    assert [regular["pdb"], lispro["pdb"]] == ["1TRZ", "1LPH"]
    assert regular["assembly_id"] == lispro["assembly_id"] == 3
    coordinates = []
    for structure, terminal_sequence in [
        (regular, ["PRO", "LYS"]),
        (lispro, ["LYS", "PRO"]),
    ]:
        residues = {(r["chain"], r["number"]): r for r in structure["trace"]}
        assert len(residues) == 102
        for chain in ("B", "D"):
            assert [residues[chain, i]["name"] for i in (28, 29)] == terminal_sequence
        coordinates.append(
            [
                residues[c, n]["xyz"]
                for c, n in sorted(residues)
                if c in ("A", "C") or n <= 22
            ]
        )
    reference, mobile = coordinates
    fit = STRUCTURE_COMPARISON["alignment"]
    assert len(reference) == len(mobile) == fit["atom_count"] == 86
    displayed_rmsd = sqrt(
        sum(dist(a, b) ** 2 for a, b in zip(reference, mobile)) / len(mobile)
    )
    assert displayed_rmsd == pytest.approx(fit["rmsd_angstrom"], abs=0.0005)
    assert fit["rmsd_angstrom"] == 0.498


@pytest.mark.parametrize(
    "index,count,expected", [(0, 12, [3.899, 3.259]), (1, 8, [4.771, 6.084])]
)
def test_contact_endpoints_match_the_two_protomers_and_reported_measurements(
    index, count, expected
):
    specimen = STRUCTURE_COMPARISON["structures"][index]
    contacts = specimen["contacts"]
    assert (
        len(contacts)
        == count
        == len({(p["left"]["number"], p["right"]["number"]) for p in contacts})
    )
    assert all(
        p["distance_angstrom"] <= STRUCTURE_COMPARISON["cutoff_angstrom"]
        for p in contacts
    )
    targeted = specimen["site_distances"]
    assert [(p["left"]["number"], p["right"]["number"]) for p in targeted] == [
        (28, 23),
        (23, 28),
    ]
    assert [p["distance_angstrom"] for p in targeted] == expected
    for pair in [*contacts, *targeted]:
        left, right = pair["left"], pair["right"]
        assert (left["chain"], right["chain"]) == ("B", "D")
        assert 23 <= left["number"] <= 30 and 23 <= right["number"] <= 30
        assert dist(left["xyz"], right["xyz"]) == pytest.approx(
            pair["distance_angstrom"], abs=0.0005
        )
