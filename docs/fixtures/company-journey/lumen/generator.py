#!/usr/bin/env python3
"""Build Lumen's 20 synthetic company-journey documents and exact manifest."""

import hashlib
import importlib.util
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[4]
DEST = ROOT / "docs/fixtures/company-journey/lumen"
FIELDS = ("vendorName", "invoiceNumber", "amountMinor", "currency", "issuedAt",
          "dueDate", "servicePeriod", "description")

spec = importlib.util.spec_from_file_location("holdout", ROOT / "apps/api/scripts/generate-holdout.py")
holdout = importlib.util.module_from_spec(spec)
spec.loader.exec_module(holdout)


def pdf(lines):
    return holdout.pdf([[holdout.text(x, y, value, size) for x, y, value, size in lines]])


def raster(lines, ext):
    canvas = Image.new("RGB", (1240, 1600), "#fffefa")
    draw = ImageDraw.Draw(canvas)
    fonts = [ImageFont.load_default(size=n) for n in (12, 15, 18, 22)]
    for x, y, value, size, color in lines:
        draw.text((x, y), value, font=fonts[size], fill=color)
    import io
    out = io.BytesIO()
    if ext == "png":
        canvas.save(out, "PNG", optimize=False, compress_level=9)
    else:
        canvas.save(out, "JPEG", quality=96, subsampling=0, optimize=False, progressive=False)
    return out.getvalue()


def record(vendor, number, amount, description, *, currency="USD", date="2026-10-06",
           due="2026-10-27", period="2026-10", **updates):
    return {**dict(zip(FIELDS, (vendor, number, amount, currency, date, due, period, description))), **updates}


VENDORS = [
    {"key": "northstar", "name": "Northstar Type Foundry Demo", "allowed": True, "externalRef": None},
    {"key": "paperkite", "name": "Paper Kite Studio Demo", "allowed": True, "externalRef": None},
    {"key": "cobalt", "name": "Cobalt Audio Lab Demo", "allowed": True, "externalRef": None},
    {"key": "juniper", "name": "Juniper Motion Demo", "allowed": True, "externalRef": None},
    {"key": "maproom", "name": "Maproom Research Demo", "allowed": True, "externalRef": None},
    {"key": "redwood", "name": "Redwood Vendor Demo", "allowed": False, "externalRef": None},
]

docs = {}
agreements = []
cases = []


def invoice_lines(vendor, number, amount, description, idx, ext):
    # Each layout uses a distinct hierarchy and label vocabulary.
    if idx % 4 == 0:
        return [(95, 90, "NORTHSTAR / ACCOUNTS", 3, "#18223a"), (800, 100, "INVOICE", 3, "#254878"),
                (95, 230, f"Supplier: {vendor}", 2, "#111"), (95, 300, f"Invoice number: {number}", 1, "#111"),
                (95, 370, "Issue date: 2026-10-06", 1, "#111"), (650, 370, "Due date: 2026-10-27", 1, "#111"),
                (95, 470, "Service period: 2026-10", 1, "#111"), (95, 650, f"Description: {description}", 1, "#111"),
                (650, 900, f"Invoice total: USD {amount / 100:.2f}", 2, "#18223a"),
                (95, 1450, "Notes: Synthetic demo document | no tax or payment details", 0, "#777")]
    if idx % 4 == 1:
        return [(100, 110, "PAPER KITE   /   STUDIO BILLING", 3, "#493334"),
                (100, 250, "FACTURA DE SERVICIOS", 2, "#8b4b37"), (100, 340, f"Proveedor: {vendor}", 1, "#111"),
                (730, 340, f"Invoice number: {number}", 1, "#111"), (100, 430, "Emision: 2026-10-06", 1, "#111"),
                (100, 500, "Vencimiento: 2026-10-27", 1, "#111"), (100, 590, "Periodo de servicio: 2026-10", 1, "#111"),
                (100, 760, f"Description: {description}", 1, "#111"), (100, 990, f"TOTAL A COBRAR: USD {amount / 100:.2f}", 2, "#493334"),
                (100, 1450, "Notas: Documento ficticio para demostracion", 0, "#777")]
    if idx % 4 == 2:
        return [(150, 100, "COBALT AUDIO LAB", 3, "#163d3f"), (150, 195, "INVOICE / FACTURA", 2, "#28645e"),
                (150, 330, f"Proveedor: {vendor}", 1, "#111"), (150, 390, f"Invoice number: {number}", 1, "#111"),
                (700, 390, "Issue date: 2026-10-06", 1, "#111"), (700, 455, "Due date: 2026-10-27", 1, "#111"),
                (150, 540, "Periodo de servicio: 2026-10", 1, "#111"), (150, 730, f"Description: {description}", 1, "#111"),
                (700, 1000, f"Invoice total: USD {amount / 100:.2f}", 2, "#163d3f"),
                (150, 1450, "Notes: Fictional test copy - not for payment", 0, "#777")]
    return [(90, 120, "JUNIPER MOTION    FINANCE", 3, "#32304c"), (90, 255, "BILL", 3, "#54517a"),
            (90, 355, f"Supplier: {vendor}", 1, "#111"), (90, 420, f"Invoice number: {number}", 1, "#111"),
            (680, 355, "Issue date: 2026-10-06", 1, "#111"), (680, 420, "Due date: 2026-10-27", 1, "#111"),
            (90, 545, "Service period: 2026-10", 1, "#111"), (90, 745, f"Description: {description}", 1, "#111"),
            (680, 980, f"Invoice total: USD {amount / 100:.2f}", 2, "#32304c"),
            (90, 1450, "Notes: Synthetic document / no real-world value", 0, "#777")]


def add(case_id, extension, payload, extraction, action, reasons, human, final, delta, notes, document_type="INVOICE"):
    path = f"documents/{case_id}.{extension}"
    docs[path] = payload
    cases.append({"id": case_id, "file": {"path": path,
        "mimeType": {"pdf": "application/pdf", "png": "image/png", "jpg": "image/jpeg"}[extension],
        "sha256": hashlib.sha256(payload).hexdigest(), "sizeBytes": len(payload)},
        "expectedExtraction": extraction, "expectedDocumentType": document_type,
        "expected": {"action": action, "requiredReasons": reasons, "needsHumanApproval": action == "ESCALATE" and human is not None},
        "humanAction": human, "expectedFinalAction": final,
        "expectedReservationDeltaMinor": delta, "notes": notes})


for n in range(1, 9):
    vendor = VENDORS[(n - 1) % 5]
    amount = 10000
    descriptions = ["Typeface family renewal", "Editorial layout package", "Studio sound mix", "Motion title sequence",
                    "Archive map research", "Variable font specimen", "Cover grid adaptation", "Audio signature edit"]
    desc = descriptions[n - 1]
    number = f"LM-{n:04d}-26"
    ex = record(vendor["name"], number, amount, desc)
    agreement_key = f"lumen_agreement_{n:03d}"
    agreements.append({"key": agreement_key, "vendorKey": vendor["key"], "currency": "USD", "amountMinor": amount,
        "toleranceMinor": 0, "frequency": "ONE_TIME", "concept": desc, "active": True})
    ext = "pdf" if n <= 5 else ("png" if n <= 7 else "jpg")
    lines = invoice_lines(vendor["name"], number, amount, desc, n, ext)
    if ext == "pdf":
        payload = pdf([(x // 2, y // 2, value, 15 if size == 3 else 12 if size == 2 else 9 if size == 1 else 7)
                       for x, y, value, size, _ in lines])
    else:
        payload = raster(lines, ext)
    add(f"{n:03d}", ext, payload, ex, "APPROVE", [], None, "APPROVE", amount, "Exact unique ONE_TIME agreement; within automatic and budget limits.")

# A single same-company ledger: 001-008 reserve 80,000; 009 reserves 35,000.
# 011 is a byte-for-byte copy and 012 repeats supplier/invoice number with altered bytes.
v = VENDORS[0]
e1 = cases[0]["expectedExtraction"]
add("009", "png", raster([(90, 75, "NORTHSTAR TYPE FOUNDRY / INVOICE", 3, "#18223a"),
    (90, 210, f"Supplier: {v['name']}", 1, "#111"), (90, 275, "Invoice number: LM-0009-26", 1, "#111"),
    (90, 340, "Issue date: 2026-10-06", 1, "#111"), (650, 340, "Due date: 2026-10-27", 1, "#111"),
    (90, 405, "Service period: 2026-10", 1, "#111"), (90, 500, "Description: Type atlas research", 1, "#111"),
    (650, 730, "Invoice total: USD 350.00", 2, "#18223a"), (90, 1450, "Notes: Fictional demo invoice", 0, "#777")], "png"),
    record(v["name"], "LM-0009-26", 35000, "Type atlas research"), "ESCALATE",
    ["AMOUNT_ABOVE_AUTO_LIMIT", "HUMAN_APPROVAL_REQUIRED"], "APPROVE", "APPROVE", 35000,
    "Amount is above the automatic threshold and below the hard ceiling; simulated approval reserves 35,000.")
v9 = cases[8]["expectedExtraction"]
agreements.append({"key": "lumen_agreement_009", "vendorKey": v["key"], "currency": "USD", "amountMinor": 35000,
    "toleranceMinor": 0, "frequency": "ONE_TIME", "concept": v9["description"], "active": True})
add("010", "jpg", raster([(90, 95, "NORTHSTAR / SPECIAL PROJECT BILL", 3, "#324052"),
    (90, 240, f"Supplier: {v['name']}", 1, "#111"), (90, 310, "Invoice number: LM-0010-26", 1, "#111"),
    (90, 380, "Issue date: 2026-10-07", 1, "#111"), (650, 380, "Due date: 2026-10-29", 1, "#111"),
    (90, 450, "Service period: 2026-10", 1, "#111"), (90, 540, "Description: Type specimen licensing", 1, "#111"),
    (650, 680, "Invoice total: USD 340.00", 2, "#324052"), (90, 1450, "Notes: Synthetic example only", 0, "#777")], "jpg"),
    record(v["name"], "LM-0010-26", 34000, "Type specimen licensing", date="2026-10-07", due="2026-10-29"),
    "ESCALATE", ["AMOUNT_ABOVE_AUTO_LIMIT", "HUMAN_APPROVAL_REQUIRED"], "REJECT", "BLOCK", 0,
    "Human rejection is simulated; no budget reservation is created.")
agreements.append({"key": "lumen_agreement_010", "vendorKey": v["key"], "currency": "USD", "amountMinor": 34000,
    "toleranceMinor": 0, "frequency": "ONE_TIME", "concept": "Type specimen licensing", "active": True})
add("011", "pdf", docs["documents/001.pdf"], e1, "BLOCK", ["DUPLICATE_INVOICE"], None, "BLOCK", 0,
    "Byte-for-byte duplicate of case 001; same-company history must block by hash.")
add("012", "pdf", pdf([(40, 40, "NORTHSTAR | REVISED INVOICE", 20), (40, 110, f"Supplier: {e1['vendorName']}", 12),
    (40, 155, f"Invoice number: {e1['invoiceNumber']}", 12), (40, 205, "Issue date: 2026-10-06", 12),
    (40, 250, "Due date: 2026-10-27", 12), (40, 295, "Service period: 2026-10", 12),
    (40, 350, f"Description: {e1['description']}", 12), (330, 430, "Invoice total: USD 100.00", 16),
    (40, 730, "Notes: Alternative PDF encoding; same invoice identity", 8)]), e1, "BLOCK", ["DUPLICATE_INVOICE"], None, "BLOCK", 0,
    "Same supplier and invoice number as 001, with different bytes.")
v = VENDORS[5]
ex = record(v["name"], "RW-1401", 5000, "Sample palette printing")
agreements.append({"key": "lumen_agreement_013", "vendorKey": v["key"], "currency": "USD", "amountMinor": 5000,
    "toleranceMinor": 0, "frequency": "ONE_TIME", "concept": ex["description"], "active": True})
add("013", "png", raster([(75, 85, "REDWOOD SERVICES / INVOICE", 3, "#572c31"),
    (75, 230, f"Supplier: {v['name']}", 1, "#111"), (75, 300, "Invoice number: RW-1401", 1, "#111"),
    (75, 370, "Issue date: 2026-10-08", 1, "#111"), (650, 370, "Due date: 2026-10-26", 1, "#111"),
    (75, 440, "Service period: 2026-10", 1, "#111"), (75, 525, "Description: Sample palette printing", 1, "#111"),
    (650, 680, "Invoice total: USD 50.00", 2, "#572c31"), (75, 1450, "Notes: Fictional test invoice", 0, "#777")], "png"),
    record(v["name"], "RW-1401", 5000, "Sample palette printing", date="2026-10-08", due="2026-10-26"), "BLOCK", ["UNKNOWN_VENDOR"], None, "BLOCK", 0,
    "Vendor is explicitly listed as disallowed; matching agreement cannot authorize it.")
v = VENDORS[1]
ex = record(v["name"], "PK-1414", 12000, "Editorial title layout", date="2026-10-08", due="2026-10-26")
agreements.append({"key": "lumen_agreement_014", "vendorKey": v["key"], "currency": "USD", "amountMinor": 10000,
    "toleranceMinor": 0, "frequency": "ONE_TIME", "concept": ex["description"], "active": True})
add("014", "pdf", pdf([(40, 45, "PAPER KITE STUDIO / FACTURA", 18), (40, 120, f"Proveedor: {v['name']}", 12),
    (40, 175, "Invoice number: PK-1414", 12), (40, 225, "Emision: 2026-10-08", 12), (350, 225, "Vencimiento: 2026-10-26", 12),
    (40, 275, "Periodo de servicio: 2026-10", 12), (40, 335, "Concepto: Editorial title layout", 12),
    (350, 415, "TOTAL A COBRAR: USD 120.00", 16), (40, 730, "Notas: Documento ficticio", 8)]), ex, "ESCALATE", ["AGREEMENT_MISMATCH"], None, "ESCALATE", 0,
    "Known vendor and exact concept, but amount differs from its only active agreement.")
v = VENDORS[2]
ex = record(v["name"], "CA-1515", 100100, "Studio mix mastering", date="2026-10-08", due="2026-10-26")
agreements.append({"key": "lumen_agreement_015", "vendorKey": v["key"], "currency": "USD", "amountMinor": 100100,
    "toleranceMinor": 0, "frequency": "ONE_TIME", "concept": ex["description"], "active": True})
add("015", "pdf", pdf([(40, 42, "COBALT AUDIO LAB | INVOICE", 20), (40, 120, f"Supplier: {v['name']}", 12),
    (40, 175, "Invoice number: CA-1515", 12), (40, 220, "Issue date: 2026-10-08", 12), (360, 220, "Due date: 2026-10-26", 12),
    (40, 270, "Service period: 2026-10", 12), (40, 330, "Description: Studio mix mastering", 12),
    (350, 415, "Invoice total: USD 1,001.00", 16), (40, 730, "Notes: Synthetic demo", 8)]), ex, "BLOCK",
    ["AMOUNT_ABOVE_HARD_LIMIT", "BUDGET_EXCEEDED"], None, "BLOCK", 0,
    "Above the hard ceiling; also exceeds remaining ledger after cases 001-009. Both reasons are expected.")
v = VENDORS[3]
ex = record(v["name"], "JM-1616", 40000, "Short animation export", date="2026-10-09", due="2026-10-29")
agreements.append({"key": "lumen_agreement_016", "vendorKey": v["key"], "currency": "USD", "amountMinor": 40000,
    "toleranceMinor": 0, "frequency": "ONE_TIME", "concept": ex["description"], "active": True})
add("016", "pdf", pdf([(50, 55, "JUNIPER MOTION - INVOICE", 18), (50, 125, f"Supplier: {v['name']}", 12),
    (50, 180, "Invoice number: JM-1616", 12), (50, 230, "Issue date: 2026-10-09", 12),
    (340, 230, "Due date: 2026-10-29", 12), (50, 280, "Service period: 2026-10", 12),
    (50, 350, "Description: Short animation export", 12), (340, 425, "Invoice total: USD 400.00", 16),
    (50, 730, "Notes: Fictional studio bill", 8)]), ex, "BLOCK", ["BUDGET_EXCEEDED"], None, "BLOCK", 0,
    "Exact agreement and amount below hard ceiling; prior reservations leave only 35,000 minor units.")
v = VENDORS[4]
ex = record(v["name"], "MR-1717", None, "Archive index review", currency=None)
agreements.append({"key": "lumen_agreement_017", "vendorKey": v["key"], "currency": "USD", "amountMinor": 8000,
    "toleranceMinor": 0, "frequency": "ONE_TIME", "concept": ex["description"], "active": True})
add("017", "png", raster([(100, 90, "MAPROOM RESEARCH  |  INVOICE", 3, "#26374d"),
    (100, 240, f"Supplier: {v['name']}", 1, "#111"), (100, 315, "Invoice number: MR-1717", 1, "#111"),
    (100, 390, "Issue date: 2026-10-09", 1, "#111"), (650, 390, "Due date: 2026-10-29", 1, "#111"),
    (100, 465, "Service period: 2026-10", 1, "#111"), (100, 600, "Description: Archive index review", 1, "#111"),
    (100, 825, "Invoice total: $80.00", 2, "#26374d"), (100, 1450, "Notes: Currency code intentionally absent", 0, "#777")], "png"),
    ex, "ESCALATE", ["INVALID_OR_MISSING_DATA"], None, "ESCALATE", 0,
    "Visible amount uses $ only; currency is unknown, amountMinor stays null, no reservation.")
v = VENDORS[0]
ex = record(v["name"], "NS-1818", None, "Specimen family review", date="2026-10-10", due="2026-10-28")
agreements.append({"key": "lumen_agreement_018", "vendorKey": v["key"], "currency": "USD", "amountMinor": 9000,
    "toleranceMinor": 0, "frequency": "ONE_TIME", "concept": ex["description"], "active": True})
add("018", "jpg", raster([(90, 80, "NORTHSTAR TYPE FOUNDRY", 3, "#30263b"),
    (90, 215, "INVOICE", 2, "#30263b"), (90, 300, f"Supplier: {v['name']}", 1, "#111"),
    (90, 360, "Invoice number: NS-1818", 1, "#111"), (90, 420, "Issue date: 2026-10-10", 1, "#111"),
    (650, 420, "Due date: 2026-10-28", 1, "#111"), (90, 495, "Service period: 2026-10", 1, "#111"),
    (90, 590, "Description: Specimen family review", 1, "#111"), (650, 800, "Subtotal: USD 90.00", 1, "#111"),
    (650, 900, "Invoice total: USD 90.00", 2, "#30263b"), (650, 1000, "Invoice total: USD 96.00", 2, "#8e2430"),
    (90, 1450, "Notes: Conflicting final totals; synthetic demo", 0, "#777")], "jpg"),
    ex, "ESCALATE", ["INVALID_OR_MISSING_DATA"], None, "ESCALATE", 0,
    "Two contradictory final totals are visible; expected amount is null despite an exact agreement.")
ex = record("Cobalt Audio Lab Demo", None, 10000, "Payment received for mix session", issuedAt=None, dueDate=None,
            servicePeriod=None)
add("019", "pdf", pdf([(45, 50, "COBALT AUDIO LAB / PAYMENT RECEIPT", 20),
    (45, 140, "Supplier: Cobalt Audio Lab Demo", 12), (45, 205, "Receipt ref: RC-019", 12),
    (45, 270, "Received on: 2026-10-11", 12), (45, 340, "Description: Payment received for mix session", 12),
    (350, 430, "AMOUNT RECEIVED USD 100.00", 16), (45, 730, "Paid status: COMPLETE | fictional proof", 8)]),
    ex, "BLOCK", ["NOT_AN_INVOICE"], None, "BLOCK", 0, "Payment receipt is explicitly not an invoice.", "PAYMENT_RECEIPT")
ex = record("Paper Kite Studio Demo", None, 15000, "Proposed editorial layout package", issuedAt=None, dueDate=None,
            servicePeriod=None)
add("020", "pdf", pdf([(50, 48, "PAPER KITE / QUOTATION", 20), (50, 135, "Quote ref: QT-020", 12),
    (50, 195, "Prepared for: Lumen Studio Demo LLC", 12), (50, 255, "Supplier: Paper Kite Studio Demo", 12),
    (50, 315, "Quote date: 2026-10-12", 12), (50, 375, "Valid through: 2026-10-31", 12),
    (50, 440, "Description: Proposed editorial layout package", 12), (350, 530, "ESTIMATED TOTAL USD 150.00", 16),
    (50, 730, "Notes: Not a bill; no obligation created", 8)]), ex, "BLOCK", ["NOT_AN_INVOICE"], None, "BLOCK", 0,
    "Quotation is explicitly not an invoice.", "QUOTE")

manifest = {"datasetVersion": "company-journey-v1", "synthetic": True,
    "company": {"slug": "lumen", "name": "Lumen Studio Demo LLC", "currency": "USD", "timezone": "America/Caracas"},
    "rules": {"currency": "USD", "automaticLimitMinor": 30000, "hardLimitMinor": 100000,
        "monthlyBudgetMinor": 150000, "requireAllowedVendor": True, "requireAgreement": True,
        "humanApprovalEnabled": True, "reviewAboveMinor": 30000, "processDaysBeforeDue": 0,
        "scopedDelegations": []},
    "vendors": VENDORS, "agreements": agreements, "cases": cases}

document_dir = DEST / "documents"
document_dir.mkdir(parents=True, exist_ok=True)
for stale in document_dir.iterdir():
    if stale.is_file():
        stale.unlink()
for path, payload in docs.items():
    DEST.joinpath(path).write_bytes(payload)
DEST.joinpath("manifest.json").write_text(json.dumps(manifest, ensure_ascii=True, indent=2) + "\n")
print(f"Generated {len(cases)} cases, {sum(len(v) for v in docs.values())} bytes")
print(f"Expected reservation deltas: {sum(c['expectedReservationDeltaMinor'] for c in cases)} minor units")
