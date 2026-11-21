"""Rebuild the offline insulin comparison from two versioned PDB depositions.

Run with the backend Python environment. Pass --source-dir to read local copies of
1TRZ.pdb and 1LPH.pdb, or omit it to download the two pinned RCSB files.
"""

import argparse
import hashlib
import json
from pathlib import Path
from urllib.request import urlopen


OUTPUT = (
    Path(__file__).resolve().parents[1] / "app/services/insulin_interface_atoms.json"
)
CHECKSUMS = {
    "1TRZ": "cac675a9117f65874c7136b105eec2f8b41394f3308bf59be39ee4285e09c78b",
    "1LPH": "33a34573ea68a1a17f34eb0a7a1800cfe1db682d3e6c105bcfe9e697e285745d",
}


def extract(raw):
    """Keep C-alpha traces and observed terminal heavy atoms, in deposited coordinates."""
    atoms = []
    for line in raw.decode("ascii").splitlines():
        if not line.startswith("ATOM  "):
            continue
        chain, number = line[21], int(line[22:26])
        atom, residue = line[12:16].strip(), line[17:20].strip()
        if chain not in ("A", "B", "C", "D") or line[76:78].strip() in ("H", "D"):
            continue
        if line[16] not in (" ", "A") or float(line[54:60]) <= 0:
            continue
        if atom != "CA" and not (chain in ("B", "D") and 23 <= number <= 30):
            continue
        xyz = [float(line[i : i + 8]) for i in (30, 38, 46)]
        atoms.append([chain, number, residue, atom, *xyz])
    return atoms


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path)
    args = parser.parse_args()
    entries = []
    for pdb, checksum in CHECKSUMS.items():
        url = f"https://files.rcsb.org/download/{pdb}.pdb"
        if args.source_dir:
            raw = (args.source_dir / f"{pdb}.pdb").read_bytes()
        else:
            with urlopen(url, timeout=30) as response:
                raw = response.read()
        if hashlib.sha256(raw).hexdigest() != checksum:
            raise SystemExit(
                f"{pdb}: coordinate file has changed; review the deposited revision"
            )
        # One compact row per atom keeps the provenance and numerical diff reviewable.
        rows = ",\n".join(json.dumps(a, separators=(",", ":")) for a in extract(raw))
        entries.append(
            f'  "{pdb}": {{\n    "coordinates_url": "{url}",\n'
            f'    "sha256": "{checksum}",\n    "atoms": [\n{rows}\n    ]\n  }}'
        )
    OUTPUT.write_text(
        "{\n" + ",\n".join(entries) + "\n}\n", encoding="utf8", newline="\n"
    )


if __name__ == "__main__":
    main()
