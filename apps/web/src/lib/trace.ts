import type { PolicyDecision, TraceStep } from '@/contracts';
import { reasonInfo } from '@/contracts/reasons';
import { t } from '@/i18n';
import { formatMoney } from './money';

export interface EvidenceFact {
  label: string;
  value: string;
}

/**
 * Converts any evidence payload (stringified JSON or object) into human-friendly data facts.
 * Never exposes raw JSON braces or syntax to the user.
 */
export function parseEvidenceFacts(evidence: unknown, currency?: string): EvidenceFact[] {
  if (!evidence) return [];
  let parsed: Record<string, unknown> | null = null;

  if (typeof evidence === 'string') {
    const trimmed = evidence.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        return [];
      }
    } else if (trimmed && !trimmed.startsWith('[') && trimmed !== 'null' && trimmed !== 'undefined') {
      return [{ label: t('Detail'), value: trimmed }];
    }
  } else if (typeof evidence === 'object' && evidence !== null) {
    parsed = evidence as Record<string, unknown>;
  }

  if (!parsed || typeof parsed !== 'object') return [];

  const facts: EvidenceFact[] = [];
  const cur = currency ?? (typeof parsed.currency === 'string' ? parsed.currency : undefined);

  for (const [key, rawVal] of Object.entries(parsed)) {
    if (rawVal == null || rawVal === '') continue;

    // Currency amounts
    if (key.includes('Minor') || key === 'amount' || key === 'limit') {
      const num = Number(rawVal);
      if (!isNaN(num)) {
        facts.push({
          label: formatFactLabel(key),
          value: formatMoney(num, cur),
        });
        continue;
      }
    }

    if (key === 'currency') continue; // Handled with amounts

    if (key === 'allowed') {
      facts.push({
        label: t('Allowed in policy'),
        value: rawVal ? t('Yes') : t('No'),
      });
      continue;
    }

    if (key === 'status') {
      const s = String(rawVal);
      facts.push({
        label: t('Reading status'),
        value: s === 'CROSS_CHECKED' ? t('Corroborated') : s,
      });
      continue;
    }

    if (key === 'sha256') {
      facts.push({
        label: 'SHA-256',
        value: `${String(rawVal).slice(0, 12)}…`,
      });
      continue;
    }

    if (key === 'priorInvoiceId') {
      facts.push({
        label: t('Matching prior bill'),
        value: `#${String(rawVal).slice(0, 8)}`,
      });
      continue;
    }

    if (key === 'normalizedInvoiceNumber') {
      facts.push({
        label: t('Normalized number'),
        value: String(rawVal),
      });
      continue;
    }

    if (key === 'extractedVendorName' || key === 'vendorName') {
      facts.push({
        label: t('Vendor name'),
        value: String(rawVal),
      });
      continue;
    }

    if (key === 'issues') {
      const issueStr = String(rawVal).trim();
      if (issueStr) {
        facts.push({
          label: t('Check notes'),
          value: issueStr,
        });
      }
      continue;
    }

    // Skip internal ids that provide no value to end-users
    if (key.endsWith('Id') && key !== 'priorInvoiceId') continue;

    facts.push({
      label: formatFactLabel(key),
      value: String(rawVal),
    });
  }

  return facts;
}

function formatFactLabel(key: string): string {
  const spaced = key
    .replace(/Minor$/, '')
    .replace(/([A-Z])/g, ' $1')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Decision Trace for the UI.
 * Enriches server trace steps or derives a complete, intuitive step sequence
 * from persisted facts & reasons (§4.4 / §9.5).
 */
export function buildTrace(d: PolicyDecision): TraceStep[] {
  const f = d.facts;
  const cur = f.currency;
  const version = typeof d.policyVersion === 'number' ? d.policyVersion : Number(d.policyVersion) || undefined;
  const money = (v: number | undefined) => (v == null ? undefined : formatMoney(v, cur));

  // If server supplied an explicit trace, enrich it with formatted comparisons and parsed facts
  if (d.trace && d.trace.length > 0) {
    return d.trace.map((step) => {
      const copy: TraceStep = {
        ...step,
        policyVersion: step.policyVersion ?? version,
        checkedAt: step.checkedAt ?? d.checkedAt,
      };

      const ruleUpper = step.rule.toUpperCase();

      if (ruleUpper === 'EXTRACTION') {
        copy.field = copy.field ?? t('Document fields');
        copy.expected = copy.expected ?? t('Unambiguous & corroborated');
      } else if (ruleUpper === 'DUPLICATE_HASH' || ruleUpper === 'DUPLICATE_NUMBER' || ruleUpper === 'DUPLICATE_INVOICE') {
        copy.field = copy.field ?? t('Invoice identity');
        copy.expected = copy.expected ?? t('Unique, not seen before');
      } else if (ruleUpper === 'POSSIBLE_DUPLICATE') {
        copy.field = copy.field ?? t('Document similarity');
        copy.expected = copy.expected ?? t('Distinct transaction');
      } else if (ruleUpper === 'VENDOR' || ruleUpper === 'ALLOWED_VENDOR' || ruleUpper === 'UNKNOWN_VENDOR') {
        copy.field = copy.field ?? t('Vendor status');
        copy.expected = copy.expected ?? t('Allowed vendor registry');
      } else if (ruleUpper === 'AUTO_LIMIT' || ruleUpper === 'AMOUNT_LIMIT' || ruleUpper === 'AMOUNT_ABOVE_AUTO_LIMIT') {
        copy.field = copy.field ?? t('Automatic limit');
        copy.expected = copy.expected ?? (f.autoLimitMinor != null ? `≤ ${money(f.autoLimitMinor)}` : undefined);
      } else if (ruleUpper === 'HARD_LIMIT' || ruleUpper === 'AMOUNT_ABOVE_HARD_LIMIT') {
        copy.field = copy.field ?? t('Absolute ceiling');
        copy.expected = copy.expected ?? (f.hardLimitMinor != null ? `≤ ${money(f.hardLimitMinor)}` : undefined);
      } else if (ruleUpper === 'AGREEMENT' || ruleUpper === 'AGREEMENT_MISMATCH' || ruleUpper === 'MISSING_AGREEMENT') {
        copy.field = copy.field ?? t('Vendor agreement');
        copy.expected = copy.expected ?? t('Active matching agreement');
      } else if (ruleUpper === 'BUDGET' || ruleUpper === 'BUDGET_EXCEEDED' || ruleUpper === 'MISSING_BUDGET') {
        copy.field = copy.field ?? t('Monthly budget');
        copy.expected = copy.expected ?? (f.budgetRemainingMinor != null ? `≤ ${money(f.budgetRemainingMinor)} ${t('left')}` : undefined);
      } else if (ruleUpper === 'INVOICE_DATES') {
        copy.field = copy.field ?? t('Invoice dates');
        copy.expected = copy.expected ?? t('Due date ≥ issue date');
      }

      return copy;
    });
  }

  // Fallback: derive structured trace from reasons + verified facts
  return d.reasons.map((code): TraceStep => {
    const info = reasonInfo(code);
    const result: TraceStep['result'] =
      info.tone === 'ok' ? 'PASS' : info.tone === 'block' ? 'FAIL' : info.tone === 'warn' ? 'WARN' : 'INFO';
    const step: TraceStep = {
      rule: code,
      result,
      policyVersion: version,
      checkedAt: d.checkedAt,
    };
    switch (code) {
      case 'AMOUNT_ABOVE_AUTO_LIMIT':
        step.field = t('Automatic limit');
        step.observed = money(f.amountMinor);
        step.expected = f.autoLimitMinor != null ? `≤ ${money(f.autoLimitMinor)}` : undefined;
        break;
      case 'AMOUNT_ABOVE_HARD_LIMIT':
        step.field = t('Absolute ceiling');
        step.observed = money(f.amountMinor);
        step.expected = f.hardLimitMinor != null ? `≤ ${money(f.hardLimitMinor)}` : undefined;
        break;
      case 'AGREEMENT_MISMATCH':
        step.field = t('Vendor agreement');
        step.observed = money(f.amountMinor);
        step.expected = f.agreementAmountMinor != null ? `≈ ${money(f.agreementAmountMinor)}` : undefined;
        break;
      case 'BUDGET_EXCEEDED':
        step.field = t('Monthly budget');
        step.observed = money(f.amountMinor);
        step.expected = f.budgetRemainingMinor != null ? `≤ ${money(f.budgetRemainingMinor)} ${t('left')}` : undefined;
        break;
      case 'ALLOWED_VENDOR':
      case 'UNKNOWN_VENDOR':
        step.field = t('Vendor status');
        step.observed = f.vendorAllowed == null ? undefined : f.vendorAllowed ? t('Authorized') : t('Not authorized');
        step.expected = t('Allowed vendor registry');
        break;
      case 'DUPLICATE_INVOICE':
      case 'POSSIBLE_DUPLICATE':
        step.field = t('Invoice identity');
        step.observed = f.duplicateOfInvoiceId ? t('matches {id}', { id: f.duplicateOfInvoiceId }) : undefined;
        step.expected = t('Unique, not seen before');
        break;
      default:
        break;
    }
    return step;
  });
}
