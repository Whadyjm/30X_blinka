# Brisa company journey fixture review

This is a synthetic, unmeasured dataset for `Brisa Services Demo LLC`. All invoices,
vendors, and transaction details are fictional. The files contain no bank details,
real personal information, payment instructions, or live payment authorization.

`generator.py` imports the existing PDF text writer without invoking its command-line
entry point and uses Pillow for PNG/JPEG layouts. It creates 20 new documents: 12 PDFs
and 8 raster images. The layouts vary header placement, labels, typography, and field
placement while keeping the invoice labels within the parser's documented Spanish and
English vocabulary. `manifest.json` is the only reference source; no expected fields,
rules, vendors, or agreements are to be sent to a reader model.

## Sequential journey reference

Cases run in ID order in one isolated company and one rolling EUR budget. Cases 001–008
have eight distinct allowed vendors, one-time concepts, and amounts totaling 40,000
minor units. Case 009 is a 25,000 minor unit exception and is expected to receive a
simulated human approval, bringing expected reservations through 009 to 65,000. Case
010 is a 23,000 minor unit exception rejected by the simulated human reviewer and adds
no reservation. The budget therefore has 35,000 minor units available when 016 tries
to reserve 40,000; 016 also exceeds the automatic limit, so its expected reasons include
`BUDGET_EXCEEDED`, `AMOUNT_ABOVE_AUTO_LIMIT`, and `HUMAN_APPROVAL_REQUIRED`. The
reservation deltas are fixed in each case's manifest entry.

Case 011 reuses the exact bytes and hash of 001. Case 012 has distinct bytes but repeats
001's vendor and invoice number. Case 013 has a disallowed vendor with a matching
agreement; 014 has an exact vendor/concept agreement with a different amount; 015 is
above the hard limit and also exceeds the remaining budget. Case 017 has a visible
amount without a currency code and labels the normalized amount unknown. Case 018 has
two contradictory totals and labels the amount unknown. Cases 019 and 020 are visibly
a payment receipt and a quote, respectively. The receipt has no visible currency, so its
currency and normalized amount are unknown; the quote's visible EUR amount is recorded.

## Measurement status

The final manifest SHA-256 was `a4e2e96e0985eccf044bb97f16e29467d9694dd12abf659bcbeecc3c85f9d19b`.
Static validation passed for all 20 files. Offline `pypdf` extraction followed by the
project's `parsePdfText()` matched the gold fields on all 11 PDF cases. The synthetic
self-test passed 20/20 with zero unsafe approvals, but it is not an OCR or real-reader
metric.

One authorized real-reader run completed on 2026-10-17. Its full per-case evidence is
preserved at
[`company-journey-brisa-2026-10-17T22-01-40-441Z.json`](../../../evaluations/company-journey-brisa-2026-10-17T22-01-40-441Z.json).
The run attempted 20 documents, obtained 18 decisions and 2 reader failures, and marked
8/20 fully correct. It reported 17/20 exact eight-field extractions, 11 escalations,
4 blocks, 3 approvals, 2 reader failures, and 1 explicit human review. There were no
harness errors. The two reader failures, cases 003 and 008, were OpenRouter HTTP 400
responses classified `UPSTREAM_RATE_LIMIT`; they produced no decision.

| Cases | Expected | Observed | Review |
|---|---|---|---|
| 001 | Approve | Escalate: `INVALID_OR_MISSING_DATA` | Primary extraction matched the gold, while independent PDF text did not corroborate amount/currency and description; no reservation. |
| 002, 004 | Approve | Approve | Expected approvals; total reservations became 9,500 minor units. |
| 003, 008 | Approve | Reader failure | HTTP 400 `UPSTREAM_RATE_LIMIT`; no decision or reservation. |
| 005–007 | Approve | Escalate: `INVALID_OR_MISSING_DATA` | Reader warnings/corroboration prevented approval; no reservations. |
| 009 | Human approval | Escalate: `INVALID_OR_MISSING_DATA` | The human-approvable exception gate was not reached. |
| 010 | Human rejection | Escalate, then block | The only human review exercised; it was rejected and made no reservation. |
| 011 | Duplicate hash block | Block | The byte-identical duplicate was blocked, with an additional extraction reason. |
| 012 | Duplicate number block | **Approve unexpectedly** | Same vendor and invoice number as 001, but distinct bytes. Case 001 had no resolved `vendorId` because extraction was uncertain, so the duplicate-number check did not match it; 012 reserved 6,800 minor units. |
| 013 | Unknown vendor block | Escalate: `INVALID_OR_MISSING_DATA` | Extraction uncertainty prevented the intended vendor rule from being exercised. |
| 014 | Agreement mismatch escalate | Escalate: `INVALID_OR_MISSING_DATA` | The intended mismatch reason was not reached due to extraction uncertainty. |
| 015 | Hard-limit/budget block | Escalate: `INVALID_OR_MISSING_DATA` | Neither policy block was exercised. |
| 016 | Budget block | Escalate: `INVALID_OR_MISSING_DATA` | Budget insufficiency was not reached; no reservation. |
| 017 | Missing-currency escalate | Escalate | The reader left currency unknown but reported `amountMinor: 6400`; the gold remains null because no currency code is visible. |
| 018 | Contradictory-total escalate | Escalate | Correct conservative outcome with `amountMinor: null`. |
| 019–020 | Not-an-invoice block | Block | Receipt and quote were both blocked; extraction uncertainty was also recorded. |

The run ended with 16,300 minor units reserved (cases 002, 004, and 012), while the
gold journey expected 65,000 through case 009. The budget context diverged in 19 cases,
so downstream budget scenarios, including 016, were not measured as planned. The raw
runner summary reported `unsafeApprovals: 0` and `unexpectedApprovals: 1`; the former
under-counts the case 012 duplicate because its safety classification is exempted when
reference budget context has diverged. Treat the case 012 approval as an observed
approval error for this dataset, regardless of that raw counter. The reported successful
reader usage was USD 0.02612071; failed-call usage may be absent.

No references, source, or product behavior were changed after the real run, and there
was no paid rerun. No payment was sent; approvals and reservations were simulated.

The manifest rules use the strict `MandateRulesSchema` field set; human approval is
bounded by the application policy. `expectedDocumentType` is a synthetic harness label
for preflight consistency checks and is never sent to a reader.
