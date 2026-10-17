import { useState } from 'react';
import { Check, ShieldAlert, X } from 'lucide-react';
import { errorMessage } from '@/api';
import { Button } from '@/components/ui/Button';
import { InlineAlert } from '@/components/ui/Card';
import { TextAreaField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useDecideApproval } from '@/hooks/queries';
import { t } from '@/i18n';

/**
 * Human decision on an ESCALATE. The server re-validates invoice, permissions, duplicates,
 * budget and policy version before confirming (§4.5) — if it refuses, we show why and nothing is approved.
 */
export function ApprovalPanel({ approvalId, expectedDecisionId, expectedPolicyVersionId, canDecide = false, cannotDecideReason }: {
  approvalId: string; expectedDecisionId?: string; expectedPolicyVersionId?: string; canDecide?: boolean; cannotDecideReason?: string | null;
}) {
  const [justification, setJustification] = useState('');
  const [error, setError] = useState<string | null>(null);
  const decide = useDecideApproval();
  const toast = useToast();
  const valid = justification.trim().length >= 3;

  const run = (decision: 'APPROVE' | 'REJECT') => {
    setError(null);
    decide.mutate(
      { id: approvalId, input: { decision, justification: justification.trim(), expectedDecisionId, expectedPolicyVersionId } },
      {
        onSuccess: () => {
          toast.success(decision === 'APPROVE' ? t('Invoice approved.') : t('Invoice rejected.'));
          setJustification('');
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  };

  if (!canDecide) {
    return (
      <InlineAlert tone="warn">
        <span className="inline-flex items-start gap-2">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {cannotDecideReason ?? t('You can’t decide this request.')}
        </span>
      </InlineAlert>
    );
  }

  return (
    <div className="space-y-3">
      <TextAreaField
        label={t('Your reason')}
        value={justification}
        onChange={(e) => setJustification(e.target.value)}
        placeholder={t('Why is this exception acceptable?')}
        hint={t('Saved with your name and the time. History is never edited.')}
        maxLength={1000}
      />
      {error && <InlineAlert>{error}</InlineAlert>}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" icon={<Check className="size-4" aria-hidden />} disabled={!valid || decide.isPending} loading={decide.isPending && decide.variables?.input.decision === 'APPROVE'} onClick={() => run('APPROVE')}>
          {t('Approve invoice')}
        </Button>
        <Button variant="secondary" icon={<X className="size-4" aria-hidden />} disabled={!valid || decide.isPending} loading={decide.isPending && decide.variables?.input.decision === 'REJECT'} onClick={() => run('REJECT')}>
          {t('Reject')}
        </Button>
      </div>
      <p className="text-xs text-slate-500">{t('Before confirming, Oli re-checks the invoice, your permissions, duplicates, budget and the current policy version.')}</p>
    </div>
  );
}
