-- Calls are claimed before provider spend; results are appended even when the output is unusable.
CREATE TABLE ai_usage_calls (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  category TEXT NOT NULL CHECK(category IN ('INVOICE_EXTRACTION','INVOICE_OCR','PDF_CONVERSION','CHAT')),
  model TEXT NOT NULL,
  created_at TEXT NOT NULL
);
-- statement-breakpoint
CREATE INDEX ai_usage_calls_org ON ai_usage_calls(org_id, created_at);
-- statement-breakpoint
CREATE TABLE ai_usage_results (
  call_id TEXT PRIMARY KEY REFERENCES ai_usage_calls(id),
  input_tokens INTEGER CHECK(input_tokens >= 0),
  output_tokens INTEGER CHECK(output_tokens >= 0),
  total_tokens INTEGER CHECK(total_tokens >= 0)
);
-- statement-breakpoint
CREATE TRIGGER ai_usage_calls_no_update BEFORE UPDATE ON ai_usage_calls BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;
-- statement-breakpoint
CREATE TRIGGER ai_usage_calls_no_delete BEFORE DELETE ON ai_usage_calls BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;
-- statement-breakpoint
CREATE TRIGGER ai_usage_results_no_update BEFORE UPDATE ON ai_usage_results BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;
-- statement-breakpoint
CREATE TRIGGER ai_usage_results_no_delete BEFORE DELETE ON ai_usage_results BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;
