#!/usr/bin/env python3
"""Plan or sync the fixed synthetic corpus to its private R2 test bucket."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone


FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


def build_manifest():
    config = json.loads((FIXTURES / "r2-storage.json").read_text())
    corpus = json.loads((FIXTURES / "scenarios/invoices.json").read_text())
    if config["datasetPrefix"] != "datasets/" + corpus["datasetVersion"] or config["publicAccess"] is not False:
        raise ValueError("El destino debe ser privado y coincidir con la versión del dataset.")
    items = []
    for case in corpus["cases"]:
        for file in [case["file"], *case["variants"]]:
            if not re.fullmatch(r"invoices/\d{3}\.(pdf|png)", file["path"]):
                raise ValueError("Ruta de documento no admitida.")
            items.append((file["path"], file["path"], file["mimeType"], file["sha256"]))
    items += [("README.md", "reference/README.md", "text/markdown; charset=utf-8", None),
              ("scenarios/invoices.json", "reference/scenarios/invoices.json", "application/json", None),
              ("seed/company.json", "reference/seed/company.json", "application/json", None)]
    objects = []
    for source, suffix, mime, expected_hash in items:
        content = (FIXTURES / source).read_bytes()
        sha = hashlib.sha256(content).hexdigest()
        if expected_hash and sha != expected_hash:
            raise ValueError(f"Documento modificado sin regenerar escenario: {source}")
        objects.append({"source": source, "key": config["datasetPrefix"] + "/" + suffix,
                        "contentType": mime, "sizeBytes": len(content), "sha256": sha,
                        "md5": hashlib.md5(content).hexdigest()})
    if len(objects) != 63 or len({item["key"] for item in objects}) != 63:
        raise ValueError("Se esperaban 60 documentos y 3 referencias con claves únicas.")
    return {"datasetVersion": corpus["datasetVersion"], "synthetic": True, **config,
            "extractorInputPrefix": config["datasetPrefix"] + "/invoices/",
            "referencePrefix": config["datasetPrefix"] + "/reference/",
            "manifestKey": config["datasetPrefix"] + "/reference/r2-manifest.json", "objects": objects}


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def sync(manifest):
    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    if not token:
        raise ValueError("Falta CLOUDFLARE_API_TOKEN con acceso R2 de lectura/escritura en la cuenta destino.")
    base = f"https://api.cloudflare.com/client/v4/accounts/{manifest['accountId']}/r2/buckets/{manifest['bucket']}"

    def request(route, method="GET", content=None, mime=None):
        headers = {"Authorization": "Bearer " + token}
        if mime:
            headers["Content-Type"] = mime
        req = urllib.request.Request(base + route, data=content, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=60) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return None
            # Avoid logging request headers or tokens.
            raise RuntimeError(f"Cloudflare HTTP {error.code} en {method} {route}") from None

    managed = json.loads(request("/domains/managed"))["result"]
    domains = json.loads(request("/domains/custom"))["result"]
    if managed["enabled"] or any(domain["enabled"] for domain in domains.get("domains", [])):
        raise ValueError("El bucket permite acceso público; se esperaba un bucket de pruebas privado.")
    items = list(manifest["objects"])
    manifest_path = FIXTURES / "r2-manifest.json"
    content = manifest_path.read_bytes()
    items.append({"source": manifest_path.name, "key": manifest["manifestKey"],
                  "contentType": "application/json", "sha256": hashlib.sha256(content).hexdigest(),
                  "sizeBytes": len(content), "md5": hashlib.md5(content).hexdigest()})
    receipt = {"datasetVersion": manifest["datasetVersion"], "accountId": manifest["accountId"],
               "bucket": manifest["bucket"], "publicAccess": False, "objects": []}
    # Read every object first: never overwrite an existing version with different bytes.
    missing = []
    for item in items:
        route = "/objects/" + urllib.parse.quote(item["key"], safe="/")
        remote = request(route)
        if remote is None:
            missing.append(item)
        elif hashlib.sha256(remote).hexdigest() != item["sha256"]:
            raise ValueError(f"Ya existe contenido distinto en {item['key']}; publicar una nueva versión.")
    for item in missing:
        local = (FIXTURES / item["source"]).read_bytes()
        if hashlib.sha256(local).hexdigest() != item["sha256"]:
            raise ValueError(f"Archivo local cambiado durante la sincronización: {item['source']}")
        request("/objects/" + urllib.parse.quote(item["key"], safe="/"), "PUT", local, item["contentType"])
    for item in items:
        remote = request("/objects/" + urllib.parse.quote(item["key"], safe="/"))
        if remote is None or hashlib.sha256(remote).hexdigest() != item["sha256"]:
            raise ValueError(f"Falló verificación tras descarga: {item['key']}")
        receipt["objects"].append({"key": item["key"], "sizeBytes": len(remote), "sha256": item["sha256"]})
    receipt["verifiedAt"] = datetime.now(timezone.utc).isoformat()
    receipt["verification"] = "DOWNLOADED_SHA256"
    write_json(FIXTURES / "r2-upload-receipt.json", receipt)
    print(f"Verificados {len(items)} objetos privados en {manifest['bucket']}.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upload", action="store_true", help="Escribe en el bucket R2 remoto configurado.")
    args = parser.parse_args()
    manifest = build_manifest()
    write_json(FIXTURES / "r2-manifest.json", manifest)
    print(f"Plan: {len(manifest['objects'])} archivos y 1 manifest en {manifest['bucket']}.")
    if args.upload:
        sync(manifest)


if __name__ == "__main__":
    main()
