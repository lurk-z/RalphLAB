"""Outbound QSAR worker for owner-scoped jobs submitted through RalphLAB Sites."""
import json
import os
import time
import urllib.error
import urllib.request

from sqlalchemy import create_engine, text

from pipeline import run_pipeline
from qsar.predictor import Predictor

ENDPOINTS = ("skin", "eye", "sens", "acute")
REGIONS = ("forearm", "hand", "face", "eye")
LOOKUP = text("""SELECT canonical_smiles, min(coalesce(nullif(inci_name,''),canonical_name)) AS name
    FROM ingredient_registry WHERE pubchem_cid=:cid AND verification_status='verified'
    AND (qsar_eligible OR (pubchem_cid=962 AND canonical_smiles='O'))
    AND trim(canonical_smiles)<>'' GROUP BY canonical_smiles LIMIT 2""")


class InvalidFormula(ValueError):
    pass


def assess(db, predictor, formula):
    items = formula["ingredients"]
    if formula["region"] not in REGIONS or not 1 <= len(items) <= 20:
        raise InvalidFormula("Invalid formula or region")
    if len({item["cid"] for item in items}) != len(items) or any(
        type(i["cid"]) is not int or not 0 < i["percent"] <= 100 for i in items
    ) or sum(i["percent"] for i in items) > 100.0001:
        raise InvalidFormula("Invalid CID or percentages")
    resolved, sources = [], []
    with db.connect() as connection:
        for item in items:
            rows = connection.execute(LOOKUP, {"cid": item["cid"]}).mappings().all()
            if len(rows) != 1:
                raise InvalidFormula(f"CID {item['cid']} lacks one verified QSAR-ready structure in this registry")
            row = rows[0]
            name = row["name"] or f"CID {item['cid']}"
            resolved.append({"name": name, "smiles": row["canonical_smiles"], "concentration": item["percent"]})
            sources.append({**item, "name": name})
    full = run_pipeline(predictor, resolved, formula["region"])
    if full["errors"] or not full["substances"] or any(k not in full["endpoints"] for k in ENDPOINTS):
        raise InvalidFormula("The model could not evaluate the entire submitted formula")
    endpoints = {}
    for key in ENDPOINTS:
        endpoint = full["endpoints"][key]
        ingredients = [s["per_endpoint"][key] for s in full["substances"]]
        endpoints[key] = {"label_th": endpoint["label_th"], "peak_score": endpoint["peak_score"],
                          "band": endpoint["band"], "confidence": endpoint["confidence"]["level"],
                          "in_domain": all(i["in_domain"] for i in ingredients),
                          "model_versions": endpoint["model_versions"]}
    return {"engine": "RalphLAB QSAR", "region": formula["region"], "ingredients": sources,
            "endpoints": endpoints, "interpretation": full["disclaimer_th"]}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def relay(path, data):
    url = os.environ["RALPHLAB_SITE_URL"].rstrip("/")
    if not url.startswith("https://"):
        raise RuntimeError("Set an HTTPS RalphLAB site origin")
    request = urllib.request.Request(url + "/api/lab/qsar/runner/" + path,
        data=json.dumps(data, ensure_ascii=False, allow_nan=False).encode(),
        headers={"Content-Type": "application/json", "User-Agent": "RalphLAB/1.0",
                 "X-Qsar-Runner": os.environ["QSAR_RUNNER_TOKEN"]})
    with urllib.request.build_opener(NoRedirect).open(request, timeout=45) as response:
        return json.load(response)


def main():
    if not os.environ.get("QSAR_RUNNER_TOKEN"):
        raise RuntimeError("Set QSAR_RUNNER_TOKEN before starting")
    db = create_engine(os.environ["DATABASE_URL"], pool_pre_ping=True)
    predictor = Predictor(os.environ.get("MODELS_DIR", "/app/models"))
    if not predictor.is_ready():
        raise RuntimeError("Production QSAR model files are incomplete")
    print("QSAR runner ready", flush=True)
    while True:
        try:
            job = relay("claim", {})
            if not job:
                time.sleep(5)
                continue
            reply = {"id":job["id"], "lease":job["lease"]}
            try:
                reply["result"] = assess(db, predictor, job["formula"])
            except InvalidFormula as exc:
                reply["error"] = str(exc)
            except (ValueError, KeyError):
                reply["error"] = "The scientific pipeline could not score this formula"
            relay("finish", reply)
            print("Finished QSAR job", job["id"], flush=True)
        except Exception as exc:
            print("Relay unavailable:", type(exc).__name__, getattr(exc, "code", ""), flush=True)
            time.sleep(10)


if __name__ == "__main__":
    main()
