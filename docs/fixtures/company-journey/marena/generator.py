"""New predeclared 20-document sample; original bytes only go to readers."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
spec = importlib.util.spec_from_file_location("pdf_writer", ROOT / "apps/api/scripts/generate-holdout.py")
writer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(writer)
FIELDS = ["vendorName", "invoiceNumber", "amountMinor", "currency", "issuedAt", "dueDate", "servicePeriod", "description"]
vendors, agreements, cases, documents = [], [], [], {}


def extraction(vendor, number, amount, concept, **changes):
    return dict(zip(FIELDS, [vendor, number, amount, "USD", "2026-10-12", "2026-10-30", "2026-10", concept])) | changes


def lines(ex, amount, style=0, title="INVOICE", extras=()):
    header = ex["vendorName"] if style % 2 else "MARENA / ACCOUNTS PAYABLE"
    rows = [(42, 48, header, 18), (410, 82, title, 18),
            (42, 135, "Supplier: " + ex["vendorName"], 13),
            (42, 180, "Invoice number: " + (ex["invoiceNumber"] or "NOT PROVIDED"), 12),
            (42, 225, "Issue date: " + ex["issuedAt"], 12),
            (330, 225, "Due date: " + ex["dueDate"], 12),
            (42, 275, "Service period: " + ex["servicePeriod"], 12),
            (42, 342, "Description: " + ex["description"], 12),
            (330, 465, "Total: " + amount, 19),
            (42, 730, "Notes: Fictional demonstration only. No payment instructions.", 9)]
    if style % 3 == 1:
        rows[3] = (330, 180, rows[3][2], 12)
    if style % 3 == 2:
        rows[2] = (42, 135, "Supplier:", 12)
        rows.insert(3, (42, 155, ex["vendorName"], 13))
    return rows + list(extras)


def render(rows, extension, rotate=False):
    if extension == "pdf":
        return writer.pdf([[writer.text(x, y, value, size) for x, y, value, size in rows]])
    image = Image.new("RGB", (1300, 1650), "#fffdf7")
    draw = ImageDraw.Draw(image)
    draw.line((80, 210, 1200, 210), fill="#31546a", width=4)
    for x, y, value, size in rows:
        draw.text((int(x * 2), int(y * 2)), value, fill="#162a36", font=ImageFont.load_default(size=int(size * 2)))
    if rotate:
        image = image.rotate(1, expand=True, fillcolor="white")
    output = io.BytesIO()
    image.save(output, format="JPEG" if extension == "jpg" else "PNG", **({"quality": 94} if extension == "jpg" else {}))
    return output.getvalue()


def add(index, ex, amount, extension, action, reasons=(), human=None, final=None, delta=0,
        *, agreed=None, allowed=True, title="INVOICE", kind="INVOICE", extras=(), rows=None, payload=None):
    case_id = f"{index:03d}"
    vendor_key = "vendor_" + case_id
    vendors.append({"key": vendor_key, "name": ex["vendorName"], "allowed": allowed, "externalRef": None})
    if agreed is not None:
        agreements.append({"key": "agreement_" + case_id, "vendorKey": vendor_key, "currency": "USD", "amountMinor": agreed,
                           "toleranceMinor": 0, "frequency": "ONE_TIME", "concept": ex["description"], "active": True})
    body = payload if payload is not None else render(rows if rows is not None else lines(ex, amount, index, title, extras), extension, index == 8)
    path = f"documents/{case_id}.{extension}"
    documents[path] = body
    cases.append({"id": case_id, "file": {"path": path, "mimeType": "application/pdf" if extension == "pdf" else "image/jpeg" if extension == "jpg" else "image/png",
                 "sha256": hashlib.sha256(body).hexdigest(), "sizeBytes": len(body)}, "expectedExtraction": ex,
                  "expectedDocumentType": kind, "expected": {"action": action, "requiredReasons": list(reasons),
                  "needsHumanApproval": human is not None}, "humanAction": human, "expectedFinalAction": final or action,
                  "expectedReservationDeltaMinor": delta, "notes": "Predeclared synthetic case; no real payment."})


regular = [
    ("Granite Data Demo LLC", "Secure archive capacity", 15000, "pdf"),
    ("Sierra Forms Demo Ltd", "Document layout review", 6000, "png"),
    ("Copper Lake Design Demo", "Catalogue cover proof", 7000, "pdf"),
    ("Blue Fern Hosting Demo", "Application uptime monitoring", 8000, "jpg"),
    ("Amber Field Support Demo", "Support inbox coverage", 9000, "pdf"),
    ("Meadow Grid Demo LLC", "Search index maintenance", 10000, "png"),
    ("Tamarind Audio Demo", "Interview sound cleanup", 11000, "pdf"),
    ("Indigo Map Demo Ltd", "Dispatch route annotation", 12000, "jpg"),
]
for index, (vendor, concept, amount, extension) in enumerate(regular, 1):
    add(index, extraction(vendor, f"MN-{index:03d}-2026", amount, concept), f"USD {amount / 100:.2f}", extension,
        "APPROVE", delta=amount, agreed=amount)

for index, vendor, amount, human, extension in [
    (9, "Birch Ledger Demo LLC", 30000, "APPROVE", "pdf"),
    (10, "Coral Ridge Research Demo", 35000, "REJECT", "png"),
]:
    ex = extraction(vendor, f"MN-{index:03d}-2026", amount, "One time operations review")
    add(index, ex, f"USD {amount / 100:.2f}", extension, "ESCALATE", ["AMOUNT_ABOVE_AUTO_LIMIT", "HUMAN_APPROVAL_REQUIRED"],
        human, "APPROVE" if human == "APPROVE" else "BLOCK", amount if human == "APPROVE" else 0, agreed=amount)

original = cases[0]["expectedExtraction"]
add(11, original.copy(), "USD 150.00", "pdf", "BLOCK", ["DUPLICATE_INVOICE"], payload=documents["documents/001.pdf"])
revised = original | {"amountMinor": 6500, "description": "Archive transfer consultation"}
add(12, revised, "USD 65.00", "png", "BLOCK", ["DUPLICATE_INVOICE"], agreed=6500)
add(13, extraction("Unlisted Harbor Demo", "MN-013-2026", 7500, "Unrequested export service"), "USD 75.00", "pdf", "BLOCK", ["UNKNOWN_VENDOR"], allowed=False, agreed=7500)
add(14, extraction("Cedar Frame Demo", "MN-014-2026", 12500, "Annual visual review"), "USD 125.00", "jpg", "ESCALATE", ["AGREEMENT_MISMATCH"], agreed=10000)
add(15, extraction("Violet Relay Demo", "MN-015-2026", 110000, "Relay infrastructure setup"), "USD 1,100.00", "pdf", "BLOCK", ["AMOUNT_ABOVE_HARD_LIMIT"], agreed=110000)
add(16, extraction("Canyon Survey Demo", "MN-016-2026", 80000, "Regional capacity survey"), "USD 800.00", "pdf", "BLOCK", ["BUDGET_EXCEEDED"], agreed=80000)
add(17, extraction("Moss Archive Demo", "MN-017-2026", None, "Archive classification", currency=None), "$ 85.00", "png", "ESCALATE", ["INVALID_OR_MISSING_DATA"], agreed=8500)
add(18, extraction("Cloudberry Metrics Demo", "MN-018-2026", None, "Monthly metrics summary"), "USD 90.00", "jpg", "ESCALATE", ["INVALID_OR_MISSING_DATA"], agreed=9000,
    extras=[(330, 515, "Total: USD 120.00", 19)])
for index, title, kind, vendor in [(19, "DELIVERY NOTE", "DELIVERY_NOTE", "Elm Package Demo"), (20, "QUOTATION", "QUOTE", "Dune Creative Demo")]:
    ex = extraction(vendor, None, None, "Draft artwork package")
    rows = [(42, 55, title, 25), (42, 135, "Supplier: " + vendor, 13), (42, 190, "Reference: MN-NEG-" + str(index), 12),
            (42, 240, "Issue date: 2026-10-12", 12), (42, 285, "Due date: 2026-10-30", 12),
            (42, 330, "Service period: 2026-10", 12), (42, 375, "Currency: USD", 12),
            (42, 430, "Description: Draft artwork package", 12), (42, 540, "No amount due. This document is not a bill.", 13),
            (42, 730, "Notes: Fictional demonstration only.", 9)]
    add(index, ex, "", "pdf", "BLOCK", ["NOT_AN_INVOICE"], title=title, kind=kind, rows=rows)

# Repeated identities reuse the original vendor; new concepts retain distinct agreements.
by_name = {}
for vendor in vendors:
    if vendor["name"] in by_name:
        for agreement in agreements:
            if agreement["vendorKey"] == vendor["key"]:
                agreement["vendorKey"] = by_name[vendor["name"]]["key"]
    else:
        by_name[vendor["name"]] = vendor
manifest = {"datasetVersion": "marena-holdout-v1-predeclared", "synthetic": True,
            "company": {"slug": "marena", "name": "Marena Demo Operations LLC", "currency": "USD", "timezone": "America/Caracas"},
            "rules": {"currency": "USD", "automaticLimitMinor": 20000, "hardLimitMinor": 100000, "monthlyBudgetMinor": 180000,
                      "requireAllowedVendor": True, "requireAgreement": True, "humanApprovalEnabled": True,
                      "reviewAboveMinor": 20000, "processDaysBeforeDue": 0, "scopedDelegations": []},
            "vendors": list(by_name.values()), "agreements": agreements, "cases": cases}
assert len(cases) == 20 and len(documents) == 20
assert sum(case["expectedReservationDeltaMinor"] for case in cases) == 108000
assert len([c for c in cases[:8] if c["expectedFinalAction"] == "APPROVE"]) == 8
for path, body in documents.items():
    target = HERE / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(body)
(HERE / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(json.dumps({"documents": 20, "reservedMinor": 108000, "callsToModels": 0}))
