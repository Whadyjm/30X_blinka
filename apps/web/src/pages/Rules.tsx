import { useState } from 'react';
import { Pencil, ShieldCheck } from 'lucide-react';
import { errorMessage } from '@/api';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, ErrorState, InlineAlert, PageHeader, Skeleton } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import type { FinanceMandate, MandateDraftInput } from '@/contracts';
import { AgreementsPanel, VendorsPanel } from '@/features/rules/ReferenceData';
import { hasErrors, MandateForm, validateMandate } from '@/features/rules/MandateForm';
import { changedRows, MandateSummary, toDraftInput } from '@/features/rules/MandateSummary';
import { useActivateMandate, useMandate, useMe, useSaveMandateDraft } from '@/hooks/queries';
import { t } from '@/i18n';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/dates';

// English source labels (i18n keys) — translated at render time.
const TABS = ['Mandate', 'Vendors', 'Agreements'] as const;

export function Rules() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Mandate');
  const me = useMe();
  const isOwner = me.data?.role === 'owner';

  return (
    <>
      <PageHeader title={t('Rules')} subtitle={t('What Oli may approve on its own, and who it may pay. Changes create a new, auditable version.')} />
      <div role="tablist" aria-label={t('Rules sections')} className="mb-5 flex gap-1 border-b border-hairline">
        {TABS.map((tabId) => (
          <button
            key={tabId}
            role="tab"
            type="button"
            aria-selected={tab === tabId}
            onClick={() => setTab(tabId)}
            className={cn('-mb-px border-b-2 px-4 py-2 text-sm', tab === tabId ? 'border-ink text-ink' : 'border-transparent text-ash hover:text-ink')}
          >
            {t(tabId)}
          </button>
        ))}
      </div>

      {!isOwner && <div className="mb-4"><InlineAlert tone="info">{t('You can view the rules. Only an owner can change them.')}</InlineAlert></div>}

      {tab === 'Mandate' && <MandateTab isOwner={isOwner} />}
      {tab === 'Vendors' && (
        <Card>
          <CardHeader title={t('Authorized vendors')} subtitle={t('Vendors not on this list are blocked.')} />
          <div className="p-5"><VendorsPanel readOnly={!isOwner} /></div>
        </Card>
      )}
      {tab === 'Agreements' && <AgreementsTab isOwner={isOwner} />}
    </>
  );
}

function AgreementsTab({ isOwner }: { isOwner: boolean }) {
  const m = useMandate();
  return (
    <Card>
      <CardHeader title={t('Agreements')} subtitle={t('What each vendor normally charges. Invoices that differ are flagged.')} />
      <div className="p-5"><AgreementsPanel currency={m.data?.active?.currency ?? 'USD'} readOnly={!isOwner} /></div>
    </Card>
  );
}

function MandateTab({ isOwner }: { isOwner: boolean }) {
  const q = useMandate();
  const save = useSaveMandateDraft();
  const activate = useActivateMandate();
  const toast = useToast();
  const [mode, setMode] = useState<'view' | 'edit' | 'review'>('view');
  const [draft, setDraft] = useState<MandateDraftInput | null>(null);
  const [saved, setSaved] = useState<FinanceMandate | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);

  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const active = q.data?.active;
  if (!active) return null;

  const startEdit = () => {
    setDraft(q.data?.draft ? toDraftInput(q.data.draft) : toDraftInput(active));
    setFormKey((k) => k + 1);
    setError(null);
    setMode('edit');
  };

  const review = () => {
    if (!draft) return;
    if (hasErrors(validateMandate(draft))) {
      setError(t('Fix the highlighted fields first.'));
      return;
    }
    setError(null);
    save.mutate(draft, {
      onSuccess: (m) => { setSaved(m); setDraft(toDraftInput(m)); setConfirmed(false); setMode('review'); },
      onError: (e) => setError(errorMessage(e)),
    });
  };

  const doActivate = () => {
    activate.mutate(saved ?? undefined, {
      onSuccess: (m) => { toast.success(t('Rules v{n} are now active.', { n: m.version })); setMode('view'); setDraft(null); setSaved(null); },
      onError: (e) => setError(errorMessage(e)),
    });
  };

  if (mode === 'view') {
    return (
      <Card>
        <CardHeader
          title={<span className="inline-flex items-center gap-2">{t('Mandate')} <span className="rounded-md bg-highlighter px-2 py-0.5 text-xs text-ink">{t('v{n} active', { n: active.version })}</span></span>}
          subtitle={
            active.createdAt
              ? active.createdByName
                ? t('Activated {when} by {name}', { when: formatDateTime(active.createdAt), name: active.createdByName })
                : t('Activated {when}', { when: formatDateTime(active.createdAt) })
              : undefined
          }
          action={isOwner ? <Button variant="secondary" icon={<Pencil className="size-4" aria-hidden />} onClick={startEdit}>{t('Edit rules')}</Button> : undefined}
        />
        <div className="space-y-3 p-5">
          <MandateSummary mandate={active} />
          {q.data?.draft && isOwner && <InlineAlert tone="info">{t('There’s a saved draft (v{n}). Click “Edit rules” to continue it.', { n: q.data.draft.version })}</InlineAlert>}
          <p className="text-xs text-ash">{t('Old versions stay on record so every past decision can be explained with the rules that applied at the time.')}</p>
        </div>
      </Card>
    );
  }

  if (mode === 'edit' && draft) {
    return (
      <Card>
        <CardHeader title={t('Edit rules')} subtitle={t('Nothing changes until you review and activate.')} />
        <div className="space-y-6 p-5">
          <MandateForm key={formKey} value={draft} onChange={setDraft} showErrors />
          {error && <InlineAlert>{error}</InlineAlert>}
          <div className="flex flex-wrap gap-2">
            <Button onClick={review} loading={save.isPending}>{t('Review changes')}</Button>
            <Button variant="ghost" onClick={() => setMode('view')} disabled={save.isPending}>{t('Cancel')}</Button>
          </div>
        </div>
      </Card>
    );
  }

  if (mode === 'review' && saved) {
    const changed = changedRows(saved, active);
    return (
      <Card>
        <CardHeader title={t('Review & activate v{n}', { n: saved.version })} subtitle={t('Changed values are highlighted next to the current ones.')} />
        <div className="space-y-4 p-5">
          <MandateSummary mandate={saved} compareTo={active} />
          {changed.length === 0 && <InlineAlert tone="info">{t('No values changed compared with the active version.')}</InlineAlert>}
          <InlineAlert tone="warn">{t('Pending approvals are re-checked against the new rules before anyone can confirm them.')}</InlineAlert>
          <Checkbox checked={confirmed} onChange={setConfirmed} label={t('I confirm these rules and understand Oli will apply them from now on.')} />
          {error && <InlineAlert>{error}</InlineAlert>}
          <div className="flex flex-wrap gap-2">
            <Button beam icon={<ShieldCheck className="size-4" aria-hidden />} disabled={!confirmed} loading={activate.isPending} onClick={doActivate}>
              {t('Activate v{n}', { n: saved.version })}
            </Button>
            <Button variant="ghost" onClick={() => setMode('edit')} disabled={activate.isPending}>{t('Back to editing')}</Button>
          </div>
        </div>
      </Card>
    );
  }
  return null;
}
