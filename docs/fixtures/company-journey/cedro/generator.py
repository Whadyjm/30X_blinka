#!/usr/bin/env python3
"""Generate Cedro's deterministic, fully synthetic company-journey corpus."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[4]
DEST = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("holdout_writer", ROOT / "apps/api/scripts/generate-holdout.py")
HOLDOUT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HOLDOUT)

VENDORS = {
    "v01": ("Alder Route Systems Demo", True),
    "v02": ("Copper Kite Freight Demo", True),
    "v03": ("Juniper Ledger Services Demo", True),
    "v04": ("Mosaic Relay Studio Demo", True),
    "v05": ("Quiet Harbor Network Demo", True),
    "v06": ("Velvet Compass Supply Demo", True),
    "v07": ("Northstar Parcel Lab Demo", True),
    "v08": ("Paper Lantern Systems Demo", True),
    "v09": ("Orbit Finch Analytics Demo", True),
    "v10": ("Cobalt Meadow Consulting Demo", True),
    "v12": ("Larkspur Transit Demo", False),
    "v13": ("Maple Circuit Works Demo", True),
    "v14": ("Amber Current Studio Demo", True),
    "v15": ("Silver Poppy Operations Demo", True),
    "v16": ("Banyan Thread Logistics Demo", True),
    "v17": ("Cloudberry Dispatch Demo", True),
    "v18": ("Saffron Bridge Tools Demo", True),
    "v19": ("Blue Acorn Office Demo", True),
}


def pdf(lines):
    return HOLDOUT.pdf([[HOLDOUT.text(x, y, value, size) for x, y, value, size in lines]])


def image(lines, fmt="PNG", accent="#315e54", rotated=0):
    im = Image.new("RGB", (1275, 1650), "#fffdf8")
    d = ImageDraw.Draw(im)
    regular = ImageFont.load_default(size=27)
    bold = ImageFont.load_default(size=35)
    d.rectangle((0, 0, 1275, 140), fill=accent)
    d.text((70, 42), "CEDRO LOGISTICS DEMO LLC   /   SYNTHETIC", font=bold, fill="white")
    y = 195
    for label, value in lines:
        if label == "__gap__":
            y += 28
            continue
        d.text((80, y), label, font=regular, fill="#63716c")
        d.text((430, y), value, font=bold if label.lower().startswith("total") else regular, fill="#17231f")
        y += 66
    d.line((75, 1500, 1190, 1500), fill=accent, width=3)
    d.text((80, 1525), "Notes: fictional training document; no tax or payment value", font=regular, fill="#63716c")
    if rotated:
        im = im.rotate(rotated, expand=True, fillcolor="white")
    b = io.BytesIO()
    im.save(b, format=fmt, quality=94 if fmt == "JPEG" else None, optimize=False)
    return b.getvalue()


records, payloads, vendors, agreements = [], {}, [], []
for key, (name, allowed) in VENDORS.items():
    vendors.append({"key": key, "name": name, "allowed": allowed, "externalRef": None})


def add(cid, ext, data, ex, action, reasons=(), human=None, final=None, delta=0, notes=""):
    path = f"documents/{cid}.{ext}"
    payloads[path] = data
    records.append({
        "id": cid,
        "file": {"path": path, "mimeType": {"pdf": "application/pdf", "png": "image/png", "jpg": "image/jpeg"}[ext],
                 "sha256": hashlib.sha256(data).hexdigest(), "sizeBytes": len(data)},
        "expectedExtraction": ex,
        "expectedDocumentType": "PAYMENT_RECEIPT" if cid == "019" else "QUOTE" if cid == "020" else "INVOICE",
        "expected": {"action": action, "requiredReasons": list(reasons),
                     "needsHumanApproval": human is not None},
        "humanAction": human,
        "expectedFinalAction": final or action,
        "expectedReservationDeltaMinor": delta,
        "notes": notes,
    })


def extraction(vendor, number, amount, description, currency="USD", issued="2026-10-06", due="2026-10-26", period="2026-10"):
    return {"vendorName": vendor, "invoiceNumber": number, "amountMinor": amount, "currency": currency,
            "issuedAt": issued, "dueDate": due, "servicePeriod": period, "description": description}


def make_invoice(cid, vendor_key, amount, concept, number=None, ext="pdf", currency="USD", layout=0, tax="Invoice"):
    vendor = VENDORS[vendor_key][0]
    number = number or f"{vendor_key.upper()}-{cid}"
    ex = extraction(vendor, number, amount, concept, currency)
    pretty = f"{amount // 100}.{amount % 100:02d}" if amount is not None else ""
    total = f"{currency} {pretty}" if currency else pretty
    if layout % 3 == 0:
        lines = [(55, 35, "INVOICE  /  " + vendor, 23), (55, 95, "Supplier: " + vendor, 14),
                 (330, 95, "Invoice number: " + number, 14), (55, 150, "Issue date: 2026-10-06", 13),
                 (330, 150, "Due date: 2026-10-26", 13), (55, 205, "Service period: 2026-10", 13),
                 (55, 280, "Description: " + concept, 14), (55, 390, "Total: " + total, 21),
                 (55, 510, "Notes: synthetic document for demonstration only", 10)]
        data = pdf(lines) if ext == "pdf" else image([("Invoice number", number), ("Supplier", vendor), ("Issue date", "2026-10-06"), ("Due date", "2026-10-26"), ("Service period", "2026-10"), ("Description", concept), ("Total", total)], fmt="JPEG" if ext == "jpg" else "PNG")
    elif layout % 3 == 1:
        rows = [("Numero", number), ("Proveedor", vendor), ("Emision", "2026-10-06"),
                ("Vencimiento", "2026-10-26"), ("Periodo de servicio", "2026-10"), ("Concepto", concept),
                ("Total a cobrar", total)]
        data = image(rows, accent="#675090", fmt="JPEG" if ext == "jpg" else "PNG") if ext != "pdf" else pdf([(55, 45, "FACTURA", 24), (55, 105, "Numero: " + number, 13),
                 (55, 155, "Proveedor: " + vendor, 13), (55, 205, "Emision: 2026-10-06", 13),
                 (55, 255, "Vencimiento: 2026-10-26", 13), (55, 305, "Periodo de servicio: 2026-10", 13),
                 (55, 380, "Concepto: " + concept, 14), (55, 490, "Total a cobrar: " + total, 20), (55, 600, "Notas: documento ficticio", 10)])
    else:
        rows = [("Invoice number", number), ("Supplier", vendor), ("Issued date", "2026-10-06"),
                ("Due date", "2026-10-26"), ("Service period", "2026-10"), ("Description", concept), ("Total", total)]
        data = image(rows, accent="#8a5839", fmt="JPEG" if ext == "jpg" else "PNG") if ext != "pdf" else pdf([(55, 40, "BILLING STATEMENT", 23), (55, 105, "Supplier: " + vendor, 13),
                 (55, 155, "Invoice number: " + number, 13), (55, 205, "Issued date: 2026-10-06", 13),
                 (55, 255, "Due date: 2026-10-26", 13), (55, 305, "Service period: 2026-10", 13),
                 (55, 375, "Description: " + concept, 14), (55, 500, "Total: " + total, 20), (55, 610, "Notes: fictional training copy", 10)])
    return ex, data


# Eight individually authorized one-time obligations, below both automation thresholds.
normal = [
    ("v01", 10000, "Regional route mapping", "pdf", 0), ("v02", 10000, "Parcel sorting support", "png", 1),
    ("v03", 10000, "Monthly ledger export", "pdf", 2), ("v04", 10000, "Warehouse signage design", "jpg", 0),
    ("v05", 10000, "Network health snapshot", "pdf", 1), ("v06", 10000, "Reusable crate labels", "png", 2),
    ("v07", 10000, "Dispatch map maintenance", "pdf", 0), ("v08", 10000, "Document archive indexing", "pdf", 2),
]
for i, (vk, amount, concept, ext, layout) in enumerate(normal, 1):
    cid = f"{i:03d}"
    ex, data = make_invoice(cid, vk, amount, concept, ext=ext, layout=layout)
    agreements.append({"key": f"agr_{cid}", "vendorKey": vk, "currency": "USD", "amountMinor": amount,
                       "toleranceMinor": 0, "frequency": "ONE_TIME", "concept": concept, "active": True})
    add(cid, ext, data, ex, "APPROVE", delta=amount, notes="Unique concept and one-time agreement; within automatic limits.")

# 009 and 010 each require human review; only 009 is approved.
for cid, vk, amount, concept, ext, layout, human, final, delta in [
    ("009", "v09", 60000, "Cross-border lane review", "png", 1, "APPROVE", "APPROVE", 60000),
    ("010", "v10", 70000, "Fleet capacity planning", "pdf", 2, "REJECT", "BLOCK", 0),
]:
    ex, data = make_invoice(cid, vk, amount, concept, ext=ext, layout=layout)
    agreements.append({"key": f"agr_{cid}", "vendorKey": vk, "currency": "USD", "amountMinor": amount,
                       "toleranceMinor": 0, "frequency": "ONE_TIME", "concept": concept, "active": True})
    add(cid, ext, data, ex, "ESCALATE", ["AMOUNT_ABOVE_AUTO_LIMIT", "HUMAN_APPROVAL_REQUIRED"], human, final, delta,
        "Agreement and policy permit human exception; simulated human action only.")

# 011: exact-byte duplicate of 001. 012: same vendor and number, different bytes.
payloads["documents/011.pdf"] = payloads["documents/001.pdf"]
add("011", "pdf", payloads["documents/011.pdf"], records[0]["expectedExtraction"], "BLOCK", ["DUPLICATE_INVOICE"], notes="Byte-identical copy of 001; server hash must identify it.")
ex, data = make_invoice("012", "v01", 10000, "Regional route mapping", number=records[0]["expectedExtraction"]["invoiceNumber"], layout=1)
add("012", "pdf", data, ex, "BLOCK", ["DUPLICATE_INVOICE"], notes="Same vendor and invoice number as 001; content and hash differ.")

# 013: unlisted supplier. 014: known supplier, concept agrees but amount differs.
ex, data = make_invoice("013", "v12", 12000, "Unlisted seasonal courier", ext="png", layout=1)
add("013", "png", data, ex, "BLOCK", ["UNKNOWN_VENDOR"], notes="Explicitly disallowed supplier; matching amount cannot grant permission.")
ex, data = make_invoice("014", "v13", 14000, "Catalog record cleanup", layout=2)
agreements.append({"key": "agr_014", "vendorKey": "v13", "currency": "USD", "amountMinor": 10000,
                   "toleranceMinor": 0, "frequency": "ONE_TIME", "concept": "Catalog record cleanup", "active": True})
add("014", "pdf", data, ex, "ESCALATE", ["AGREEMENT_MISMATCH"], notes="Allowed supplier and unique concept; only amount conflicts with its agreement.")

# 015 hard limit and 016 remaining budget, both remain under no human override.
ex, data = make_invoice("015", "v14", 160000, "Map tile refresh", layout=1)
agreements.append({"key": "agr_015", "vendorKey": "v14", "currency": "USD", "amountMinor": 160000,
                   "toleranceMinor": 0, "frequency": "ONE_TIME", "concept": "Map tile refresh", "active": True})
add("015", "pdf", data, ex, "BLOCK", ["AMOUNT_ABOVE_HARD_LIMIT"], notes="USD 1,600 exceeds the hard ceiling of USD 1,500.")
ex, data = make_invoice("016", "v15", 90000, "Fleet telemetry reconciliation", ext="png", layout=2)
agreements.append({"key": "agr_016", "vendorKey": "v15", "currency": "USD", "amountMinor": 90000,
                   "toleranceMinor": 0, "frequency": "ONE_TIME", "concept": "Fleet telemetry reconciliation", "active": True})
add("016", "png", data, ex, "BLOCK", ["BUDGET_EXCEEDED"], notes="After 001-010 and simulated 009 approval, only USD 800 remains; this USD 900 obligation is below hard limit.")

# 017 currency absent; 018 has two contradictory final totals.
vendor = VENDORS["v16"][0]
ex = extraction(vendor, "V16-017", None, "Pallet tracking review", currency=None)
data = pdf([(55, 45, "INVOICE", 24), (55, 105, "Supplier: " + vendor, 13), (55, 155, "Invoice number: V16-017", 13),
            (55, 205, "Issue date: 2026-10-06", 13), (55, 255, "Due date: 2026-10-26", 13),
            (55, 305, "Service period: 2026-10", 13), (55, 375, "Description: Pallet tracking review", 14),
            (55, 500, "Total due: 95.00", 20)])
add("017", "pdf", data, ex, "ESCALATE", ["INVALID_OR_MISSING_DATA"], notes="Visible amount has no currency code; expected amountMinor and currency stay null.")
vendor = VENDORS["v17"][0]
ex = extraction(vendor, "V17-018", None, "Dock schedule audit")
data = image([("Invoice number", "V17-018"), ("Supplier", vendor), ("Issue date", "2026-10-06"), ("Due date", "2026-10-26"),
              ("Service period", "2026-10"), ("Description", "Dock schedule audit"), ("Subtotal", "USD 310.00"),
              ("Total", "USD 310.00"), ("Total a cobrar", "USD 390.00")], accent="#9d3b45")
add("018", "png", data, ex, "ESCALATE", ["INVALID_OR_MISSING_DATA"], notes="Contradictory final totals are both visible; amountMinor remains null.")

# 019 payment receipt and 020 quotation: non-invoice document classification.
vendor = VENDORS["v18"][0]
ex = extraction(vendor, None, None, None, currency=None, issued=None, due=None, period=None)
data = pdf([(55, 45, "PAYMENT RECEIPT", 25), (55, 115, "Supplier: " + vendor, 13), (55, 185, "Reference: DEMO-SETTLEMENT-19", 13),
            (55, 255, "Payment date: 2026-10-12", 13), (55, 335, "Status: PAID (simulated record)", 18),
            (55, 425, "Not an invoice and not a payment instruction.", 14)])
add("019", "pdf", data, ex, "BLOCK", ["NOT_AN_INVOICE"], notes="Clearly labeled fictional payment receipt; no invoice obligation.")
vendor = VENDORS["v19"][0]
ex = extraction(vendor, None, 42500, "Optional archive migration", issued=None, due=None, period=None)
data = image([("DOCUMENT", "QUOTATION / ESTIMATE"), ("Supplier", vendor), ("Quote reference", "QUOTE-020"),
              ("Prepared", "2026-10-09"), ("Description", "Optional archive migration"), ("Estimated total", "USD 425.00"),
              ("Validity", "30 days"), ("Terms", "Proposal only · not an invoice")], fmt="JPEG", accent="#28718b")
add("020", "jpg", data, ex, "BLOCK", ["NOT_AN_INVOICE"], notes="Clearly labeled fictional quote, not a bill or obligation.")

rules = {"currency": "USD", "automaticLimitMinor": 50000, "hardLimitMinor": 150000,
         "monthlyBudgetMinor": 220000, "requireAllowedVendor": True, "requireAgreement": True,
         "humanApprovalEnabled": True, "reviewAboveMinor": 50000, "processDaysBeforeDue": 0,
         "scopedDelegations": []}
manifest = {"datasetVersion": "company-journey-v1", "synthetic": True,
            "company": {"slug": "cedro", "name": "Cedro Logistics Demo LLC", "currency": "USD", "timezone": "America/Caracas"},
            "rules": rules, "vendors": vendors, "agreements": agreements, "cases": records}

for path, data in payloads.items():
    target = DEST / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
(DEST / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
print(f"Generated {len(records)} Cedro cases ({sum(c['file']['mimeType']=='application/pdf' for c in records)} PDF, {sum(c['file']['mimeType']!='application/pdf' for c in records)} images)")
