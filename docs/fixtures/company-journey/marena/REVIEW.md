# Marena sample fixed before live evaluation

Marena Demo Operations LLC is fictional. The sample contains 20 documents: eight normal invoices, two human review cases, two duplicates, a disallowed supplier, an agreement mismatch, hard-limit and budget violations, unknown currency, competing totals, a delivery note and a quotation. It contains 11 PDF files and nine PNG/JPEG images, with one deliberately byte-identical PDF duplicate.

The policy authorizes USD, an automatic limit of USD 200, an absolute limit of USD 1,000 and a monthly budget of USD 1,800. The eight normal invoices reserve USD 780. Explicit simulated human approval of case 009 adds USD 300; rejecting case 010 adds nothing. The expected total reservation is USD 1,080. Case 016 requests USD 800 when only USD 720 remains.

The generator uses literal document labels and several layouts, including separate supplier lines, columns, a buyer header and a slightly rotated image. These are supported label families; the sample does not establish coverage of arbitrary layouts. Invoice PDF text was independently checked with pypdf before any live model calls. The monetary reference self-test passed 20/20 without calling a model. Currency ambiguity and both conflicting totals remain visible in the original documents.

The pre-live freeze records SHA-256 `29eee11d86e2f6c4fa500bbffe8f18e3d55fc06464c70507d2ecf1c109013971` for the manifest. The targets were set before measurement: zero unsafe approvals, at least 19/20 complete expected outcomes and at least seven of eight normal invoices automatically approved with correct fields. The manifest, references and bytes must remain unchanged throughout the live evaluation.

`targeted/` contains a separate P0 regression, excluded from the denominator of 20. It presents the same supplier and invoice number as case 017, now with explicit USD. The uncertain antecedent must prevent approval and produce `POSSIBLE_DUPLICATE` with no reservation or generic human approval. Its purpose and expected outcome were fixed before submission.

Only original document bytes go to the production readers. Policies, directories, expected fields and actions remain outside model inputs. All human confirmations and reservations are simulated; no money moves.
