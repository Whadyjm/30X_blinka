#!/usr/bin/env python3
"""Build Brisa's deterministic synthetic company journey fixtures; no model calls."""

import hashlib
import importlib.util
import io
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
DOCS = HERE / "documents"
PDF_SCRIPT = ROOT / "apps/api/scripts/generate-holdout.py"
spec = importlib.util.spec_from_file_location("holdout_pdf_writer", PDF_SCRIPT)
holdout = importlib.util.module_from_spec(spec)
spec.loader.exec_module(holdout)


VENDORS = [
    ("northstar", "Northstar Cloud Demo LLC", True),
    ("maple", "Maple Office Demo GmbH", True),
    ("cobalt", "Cobalt Design Demo Ltd", True),
    ("sunbeam", "Sunbeam Network Demo LLC", True),
    ("pioneer", "Pioneer Analytics Demo BV", True),
    ("harbor", "Harbor Hosting Demo SARL", True),
    ("juniper", "Juniper Media Demo SL", True),
    ("silverline", "Silverline Support Demo Oy", True),
    ("quartz", "Quartz Data Demo LLC", True),
    ("redwood", "Redwood Studio Demo GmbH", True),
    ("willow", "Willow Systems Demo Ltd", True),
    ("northstar", "Northstar Cloud Demo LLC", True),
    ("unlisted", "Unlisted Vendor Demo LLC", False),
    ("cobalt", "Cobalt Design Demo Ltd", True),
    ("sunbeam", "Sunbeam Network Demo LLC", True),
    ("harbor", "Harbor Hosting Demo SARL", True),
    ("juniper", "Juniper Media Demo SL", True),
    ("silverline", "Silverline Support Demo Oy", True),
]

REGULAR = [
    (1, "northstar", "Invoice", "NS-2601", 4000, "Cloud archive capacity"),
    (2, "maple", "Rechnung", "MO-2602", 4500, "Office supply coordination"),
    (3, "cobalt", "Factura", "CD-2603", 5000, "Catalog layout services"),
    (4, "sunbeam", "Invoice", "SN-2604", 5000, "Network health monitoring"),
    (5, "pioneer", "Rechnung", "PA-2605", 5000, "Monthly analytics export"),
    (6, "harbor", "Factura", "HH-2606", 5000, "Backup storage allocation"),
    (7, "juniper", "Invoice", "JM-2607", 5500, "Media asset indexing"),
    (8, "silverline", "Rechnung", "SS-2608", 6000, "Support desk coverage"),
]


def pdf_page(vendor, label, number, amount, description, style=0):
    """Distinct text-only PDF layouts with labels supported by the server parser."""
    def t(x, y, s, size=12):
        return holdout.text(x, y, s, size)

    common = [
        t(42, 40, label.upper() + "  |  BRISA SERVICES", 22 if style % 2 == 0 else 17),
        t(42, 112, "Supplier: " + vendor, 13),
        t(42, 148, "Invoice number: " + number),
        t(42, 184, "Issue date: 2026-10-06"),
        t(42, 220, "Due date: 2026-10-28"),
        t(42, 256, "Service period: 2026-10"),
        t(42, 324, "Description: " + description, 14),
        t(42, 422, "Total: EUR " + f"{amount / 100:,.2f}", 20),
        t(42, 735, "Notes: Synthetic demonstration document - no fiscal or bank data", 9),
    ]
    if style % 3 == 0:
        common = [common[0], t(350, 112, "Invoice number: " + number)] + common[1:2] + common[3:]
        common[3] = t(42, 184, "Issue date: 2026-10-06")
        common[4] = t(350, 184, "Due date: 2026-10-28")
    elif style % 3 == 1:
        common[0] = t(42, 40, "BRISA / ACCOUNTS PAYABLE", 16)
        common[7] = t(350, 500, "Total: EUR " + f"{amount / 100:,.2f}", 19)
    return holdout.pdf([common])


def raster(vendor, label, number, amount_text, description, *, style=0, fmt="PNG"):
    image = Image.new("RGB", (1224, 1584), "#fbfaf6" if style % 2 else "white")
    draw = ImageDraw.Draw(image)
    fonts = [ImageFont.load_default(size=s) for s in (22, 29, 35, 42)]
    if style % 3 == 0:
        draw.rectangle((100, 90, 1120, 260), outline="#26465a", width=5)
        draw.text((140, 125), "BRISA SERVICES   /   " + label.upper(), fill="#18384d", font=fonts[2])
        y0 = 360
        fields = [
            ("Supplier:", vendor), ("Invoice number:", number), ("Issue date:", "2026-10-06"),
            ("Due date:", "2026-10-28"), ("Service period:", "2026-10"),
        ]
        for idx, (key, value) in enumerate(fields):
            draw.text((140, y0 + idx * 82), key + " : " + value, fill="#18232b", font=fonts[1])
        draw.text((140, 900), "Description: " + description, fill="#18232b", font=fonts[0])
        draw.text((140, 1120), "Total: " + amount_text, fill="#18384d", font=fonts[3])
    elif style % 3 == 1:
        draw.text((800, 100), label.upper(), fill="#524070", font=fonts[2])
        draw.text((110, 220), "Brisa Services Demo", fill="#35264d", font=fonts[3])
        draw.line((110, 310, 1110, 310), fill="#9581ad", width=6)
        fields = [("Supplier:", vendor), ("Invoice number:", number), ("Issue date:", "2026-10-06"),
                  ("Due date:", "2026-10-28"), ("Service period:", "2026-10"),
                  ("Description:", description), ("Total:", amount_text)]
        for idx, (key, value) in enumerate(fields):
            draw.text((150, 390 + idx * 90), key + "   " + value, fill="#241d29", font=fonts[1 if idx < 5 else 0])
    else:
        draw.rectangle((90, 90, 1130, 1450), outline="#45674d", width=4)
        draw.text((150, 140), "BRISA  |  " + label.upper(), fill="#31513a", font=fonts[2])
        draw.text((150, 280), "Invoice number: " + number, fill="#151d17", font=fonts[1])
        draw.text((150, 380), "Supplier: " + vendor, fill="#151d17", font=fonts[0])
        draw.text((150, 500), "Issue date: 2026-10-06", fill="#151d17", font=fonts[1])
        draw.text((150, 600), "Due date: 2026-10-28", fill="#151d17", font=fonts[1])
        draw.text((150, 700), "Service period: 2026-10", fill="#151d17", font=fonts[1])
        draw.text((150, 880), "Description: " + description, fill="#151d17", font=fonts[0])
        draw.text((150, 1080), "Total: " + amount_text, fill="#31513a", font=fonts[2])
    draw.text((120, 1490), "Notes: Fictional sample - not valid for payment", fill="#555555", font=fonts[0])
    out = io.BytesIO()
    if fmt == "JPEG":
        image.save(out, "JPEG", quality=94, optimize=False, progressive=False, subsampling=0)
    else:
        image.save(out, "PNG", optimize=False, compress_level=9)
    return out.getvalue()


def add_case(cases, payloads, cid, ext, payload, extraction, action, reasons, needs_human,
             human_action, final_action, reservation_delta, notes):
    rel = f"documents/{cid}.{ext}"
    payloads[rel] = payload
    cases.append({
        "id": cid,
        "file": {"path": rel, "mimeType": "application/pdf" if ext == "pdf" else
                 "image/png" if ext == "png" else "image/jpeg",
                 "sha256": hashlib.sha256(payload).hexdigest(), "sizeBytes": len(payload)},
        "expectedExtraction": extraction,
        "expectedDocumentType": "PAYMENT_RECEIPT" if cid == "019" else
                               "QUOTE" if cid == "020" else "INVOICE",
        "expected": {"action": action, "requiredReasons": reasons, "needsHumanApproval": needs_human},
        "humanAction": human_action,
        "expectedFinalAction": final_action,
        "expectedReservationDeltaMinor": reservation_delta,
        "notes": notes,
    })


def build():
    cases, payloads, agreements = [], {}, []
    vendors = []
    for key, name, allowed in VENDORS:
        if not any(row["key"] == key for row in vendors):
            vendors.append({"key": key, "name": name, "allowed": allowed, "externalRef": None})

    def agreement(key, description, amount):
        vkey = key.split("-")[0]
        agreements.append({"key": "agr-" + key, "vendorKey": vkey, "currency": "EUR",
                           "amountMinor": amount, "toleranceMinor": 0, "frequency": "ONE_TIME",
                           "concept": description, "active": True})

    def extraction(vendor, number, amount, description, *, currency="EUR", issue="2026-10-06",
                  due="2026-10-28", period="2026-10"):
        return {"vendorName": vendor, "invoiceNumber": number, "amountMinor": amount,
                "currency": currency, "issuedAt": issue, "dueDate": due,
                "servicePeriod": period, "description": description}

    for i, (n, vkey, label, number, amount, desc) in enumerate(REGULAR, 1):
        vendor = next(v[1] for v in VENDORS if v[0] == vkey)
        agreement(f"{vkey}-{n:03d}", desc, amount)
        ex = extraction(vendor, number, amount, desc)
        ext = "png" if n == 2 else "jpg" if n == 4 else "pdf" if n in (1, 3, 5, 7, 8) else "jpg"
        text_amount = f"EUR {amount / 100:,.2f}"
        content = (raster(vendor, label, number, text_amount, desc, style=n, fmt="JPEG" if ext == "jpg" else "PNG")
                   if ext != "pdf" else pdf_page(vendor, label, number, amount, desc, n))
        add_case(cases, payloads, f"{n:03d}", ext, content, ex, "APPROVE", [], False, None,
                 "APPROVE", amount, "Distinct one-time agreement; concept resolves it without an embedded reference.")

    # 009 is a human-approved exception; 010 is the same allowed exception rejected by the reviewer.
    for n, vkey, label, number, amount, desc, human, final, delta in [
        (9, "quartz", "Invoice", "QD-2609", 25000, "Data retention expansion", "APPROVE", "APPROVE", 25000),
        (10, "redwood", "Rechnung", "RS-2610", 23000, "Creative review package", "REJECT", "BLOCK", 0),
    ]:
        vendor = next(v[1] for v in VENDORS if v[0] == vkey)
        agreement(f"{vkey}-{n:03d}", desc, amount)
        ex = extraction(vendor, number, amount, desc)
        ext = "png" if n == 10 else "pdf"
        content = raster(vendor, label, number, f"EUR {amount / 100:,.2f}", desc, style=n) if ext == "png" else pdf_page(vendor, label, number, amount, desc, n)
        add_case(cases, payloads, f"{n:03d}", ext, content, ex, "ESCALATE",
                 ["AMOUNT_ABOVE_AUTO_LIMIT", "HUMAN_APPROVAL_REQUIRED"], True, human, final, delta,
                 "Within hard limit, exact active agreement, and eligible for simulated human review.")

    # 011 is a byte-for-byte copy of 001; it intentionally reuses that original agreement.
    add_case(cases, payloads, "011", "pdf", payloads["documents/001.pdf"], cases[0]["expectedExtraction"],
             "BLOCK", ["DUPLICATE_INVOICE"], False, None, "BLOCK", 0,
             "Binary duplicate of 001: same bytes and SHA-256; no new agreement or reservation.")

    # Same vendor and invoice number as 001, but another unique concept/agreement and different bytes.
    vendor = "Northstar Cloud Demo LLC"
    desc = "Northstar incident response workshop"
    agreement("northstar-012", desc, 6800)
    ex = extraction(vendor, "NS-2601", 6800, desc)
    content = raster(vendor, "Invoice", "NS-2601", "EUR 68.00", desc, style=5, fmt="JPEG")
    add_case(cases, payloads, "012", "jpg", content, ex, "BLOCK", ["DUPLICATE_INVOICE"], False,
             None, "BLOCK", 0, "Different bytes, same vendor and normalized invoice number as 001.")

    # Explicitly unallowed vendor with a matching agreement keeps the intended rule observable.
    vendor = "Unlisted Vendor Demo LLC"
    desc = "Unlisted document processing"
    agreement("unlisted-013", desc, 7200)
    ex = extraction(vendor, "UV-2613", 7200, desc)
    content = pdf_page(vendor, "Invoice", "UV-2613", 7200, desc, 13)
    add_case(cases, payloads, "013", "pdf", content, ex, "BLOCK", ["UNKNOWN_VENDOR"], False,
             None, "BLOCK", 0, "Vendor is explicitly disallowed; an exact agreement isolates vendor policy.")

    vendor = "Cobalt Design Demo Ltd"
    desc = "Brand illustration set"
    agreement("cobalt-014", desc, 11900)
    ex = extraction(vendor, "CD-2614", 12000, desc)
    content = pdf_page(vendor, "Invoice", "CD-2614", 12000, desc, 14)
    add_case(cases, payloads, "014", "pdf", content, ex, "ESCALATE", ["AGREEMENT_MISMATCH"], False,
             None, "ESCALATE", 0, "Allowed vendor and exact concept, but amount differs from its agreement.")

    vendor = "Sunbeam Network Demo LLC"
    desc = "Core network resilience service"
    agreement("sunbeam-015", desc, 85000)
    ex = extraction(vendor, "SN-2615", 85000, desc)
    content = raster(vendor, "Invoice", "SN-2615", "EUR 850.00", desc, style=15)
    add_case(cases, payloads, "015", "png", content, ex, "BLOCK",
             ["AMOUNT_ABOVE_HARD_LIMIT", "BUDGET_EXCEEDED"], False, None, "BLOCK", 0,
             "Amount exceeds the hard limit and the remaining budget; both blocking facts are expected.")

    vendor = "Harbor Hosting Demo SARL"
    desc = "Harbor backup capacity extension"
    agreement("harbor-016", desc, 40000)
    ex = extraction(vendor, "HH-2616", 40000, desc)
    content = pdf_page(vendor, "Invoice", "HH-2616", 40000, desc, 16)
    add_case(cases, payloads, "016", "pdf", content, ex, "BLOCK",
             ["BUDGET_EXCEEDED", "AMOUNT_ABOVE_AUTO_LIMIT", "HUMAN_APPROVAL_REQUIRED"], False,
             None, "BLOCK", 0,
             "After approvals 001-009 reserve EUR 650, only EUR 350 remains; amount exceeds auto but not hard limit.")

    vendor = "Juniper Media Demo SL"
    desc = "Digital archive maintenance"
    ex = extraction(vendor, "JM-2617", None, desc, currency=None)
    content = pdf_page(vendor, "Invoice", "JM-2617", 6400, desc, 17)
    # Replace the explicit currency with an unlabeled amount; amountMinor is null because currency is unknown.
    content = content.replace(b"EUR 64.00", b"64.00")
    add_case(cases, payloads, "017", "pdf", content, ex, "ESCALATE", ["INVALID_OR_MISSING_DATA"], False,
             None, "ESCALATE", 0, "Visible amount lacks a currency code; currency and normalized amount remain unknown.")

    vendor = "Silverline Support Demo Oy"
    desc = "Support response retainer"
    ex = extraction(vendor, "SS-2618", None, desc)
    content = raster(vendor, "Invoice", "SS-2618", "EUR 76.00", desc, style=18)
    # A second incompatible explicit final total makes the visible amount ambiguous.
    image = Image.open(io.BytesIO(content)).convert("RGB")
    draw = ImageDraw.Draw(image)
    draw.text((150, 1220), "Final total: EUR 91.00", fill="#a21d1d", font=ImageFont.load_default(size=38))
    out = io.BytesIO()
    image.save(out, "JPEG", quality=94, optimize=False, progressive=False, subsampling=0)
    add_case(cases, payloads, "018", "jpg", out.getvalue(), ex, "ESCALATE", ["INVALID_OR_MISSING_DATA"], False,
             None, "ESCALATE", 0, "Two contradictory final totals are visible; amountMinor is null.")

    for n, vkey, vendor, label, number, desc, ext, doc_kind in [
        (19, "willow", "Willow Systems Demo Ltd", "Payment receipt", "", "Payment recorded for test service", "pdf", "PAYMENT_RECEIPT"),
        (20, "juniper", "Juniper Media Demo SL", "Quote", "QT-2620", "Proposed archive migration service", "png", "QUOTE"),
    ]:
        ex = extraction(vendor, number or None, 11200 if doc_kind == "QUOTE" else None, desc,
                        currency="EUR" if doc_kind == "QUOTE" else None,
                        issue="2026-10-06" if doc_kind == "QUOTE" else None, due=None, period=None)
        if doc_kind == "PAYMENT_RECEIPT":
            payload = holdout.pdf([[holdout.text(55, 55, "PAYMENT RECEIPT", 26),
                holdout.text(55, 150, "Supplier: " + vendor, 15),
                holdout.text(55, 230, "Payment reference: TEST-1919", 14),
                holdout.text(55, 330, "Description: " + desc, 14),
                holdout.text(55, 420, "Status: simulated paid", 18),
                holdout.text(55, 735, "Notes: Synthetic demonstration document", 9)]])
        else:
            payload = Image.new("RGB", (1224, 1584), "white")
            draw = ImageDraw.Draw(payload)
            title = ImageFont.load_default(size=50)
            body = ImageFont.load_default(size=34)
            draw.text((120, 130), "BRISA SERVICES / QUOTATION", fill="#294657", font=title)
            draw.text((130, 340), "Supplier: " + vendor, fill="#17242b", font=body)
            draw.text((130, 470), "Quote number: " + number, fill="#17242b", font=body)
            draw.text((130, 600), "Issue date: 2026-10-06", fill="#17242b", font=body)
            draw.text((130, 790), "Description: " + desc, fill="#17242b", font=body)
            draw.text((130, 1030), "Total: EUR 112.00", fill="#294657", font=title)
            draw.text((130, 1470), "Notes: Fictional sample - quotation only", fill="#555555", font=body)
            out = io.BytesIO()
            payload.save(out, "PNG", optimize=False, compress_level=9)
            payload = out.getvalue()
        add_case(cases, payloads, f"{n:03d}", ext, payload, ex, "BLOCK", ["NOT_AN_INVOICE"], False,
                 None, "BLOCK", 0, f"Document type is visibly {doc_kind}; it creates no payable invoice or reservation.")

    rules = {"currency": "EUR", "automaticLimitMinor": 20000, "hardLimitMinor": 80000,
             "monthlyBudgetMinor": 100000, "requireAllowedVendor": True, "requireAgreement": True,
             "humanApprovalEnabled": True, "reviewAboveMinor": 20000,
             "processDaysBeforeDue": 0,
             "scopedDelegations": []}
    manifest = {"datasetVersion": "company-journey-v1", "synthetic": True,
                "company": {"slug": "brisa", "name": "Brisa Services Demo LLC", "currency": "EUR",
                            "timezone": "America/Caracas"},
                "rules": rules, "vendors": vendors, "agreements": agreements, "cases": cases}
    return manifest, payloads


def main():
    manifest, payloads = build()
    DOCS.mkdir(parents=True, exist_ok=True)
    for path, payload in payloads.items():
        (HERE / path).write_bytes(payload)
    (HERE / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=True, indent=2) + "\n")
    verify(manifest, payloads)
    print(f"Generated {len(manifest['cases'])} Brisa fixtures; no OCR or decisions evaluated.")


def verify(manifest, payloads):
    assert len(manifest["cases"]) == 20
    assert sum(c["file"]["mimeType"] == "application/pdf" for c in manifest["cases"]) == 12
    assert sum(c["file"]["mimeType"] in ("image/png", "image/jpeg") for c in manifest["cases"]) == 8
    assert [c["id"] for c in manifest["cases"]] == [f"{n:03d}" for n in range(1, 21)]
    assert manifest["cases"][10]["file"]["sha256"] == manifest["cases"][0]["file"]["sha256"]
    approved = sum(c["expectedReservationDeltaMinor"] for c in manifest["cases"][:9])
    assert approved == 65000 and manifest["cases"][9]["expectedReservationDeltaMinor"] == 0
    assert manifest["cases"][15]["expectedExtraction"]["amountMinor"] == 40000
    for case in manifest["cases"]:
        f = case["file"]
        body = payloads[f["path"]]
        assert f["sha256"] == hashlib.sha256(body).hexdigest() and f["sizeBytes"] == len(body)
        assert len(case["expectedExtraction"]) == 8
    assert set(manifest["rules"]) == {"currency", "automaticLimitMinor", "hardLimitMinor", "monthlyBudgetMinor",
        "requireAllowedVendor", "requireAgreement", "humanApprovalEnabled", "reviewAboveMinor",
        "processDaysBeforeDue", "scopedDelegations"}
    assert manifest["cases"][18]["expectedDocumentType"] == "PAYMENT_RECEIPT"
    assert manifest["cases"][19]["expectedDocumentType"] == "QUOTE"


if __name__ == "__main__":
    main()
