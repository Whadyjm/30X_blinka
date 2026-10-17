import { useState, type FormEvent } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@/api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, InlineAlert, Skeleton } from '@/components/ui/Card';
import { MoneyField, SelectField, TextField, Toggle } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { AGREEMENT_FREQUENCIES } from '@/contracts';
import { SAMPLE_VENDOR_SET } from '@/features/onboarding/sampleSet';
import { qk, useAgreements, useSaveAgreement, useSaveVendor, useVendors } from '@/hooks/queries';
import { t } from '@/i18n';
import { formatMoney } from '@/lib/money';

// English source labels (i18n keys) — translated at render time via freqLabel().
const FREQ_LABEL: Record<string, string> = { ONE_TIME: 'One-time', WEEKLY: 'Weekly', MONTHLY: 'Monthly', QUARTERLY: 'Quarterly', ANNUAL: 'Annual' };
const freqLabel = (f: string) => (FREQ_LABEL[f] ? t(FREQ_LABEL[f]) : f);

/* ───────────────────────── vendors ───────────────────────── */

export function VendorsPanel({ readOnly }: { readOnly?: boolean }) {
  const q = useVendors();
  const save = useSaveVendor();
  const toast = useToast();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    save.mutate(
      { name: name.trim(), allowed: true },
      { onSuccess: () => { setName(''); toast.success(t('Vendor added.')); }, onError: (err) => setError(errorMessage(err)) },
    );
  };

  if (q.isLoading) return <Skeleton className="h-32" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const vendors = q.data ?? [];

  return (
    <div className="space-y-4">
      {vendors.length === 0 ? (
        <EmptyState title={t('No vendors yet')} body={t('Only vendors on this list can be paid. Add one below, or load the sample set.')} />
      ) : (
        <ul className="divide-y divide-hairline rounded-lg ring-1 ring-hairline">
          {vendors.map((v) => (
            <li key={v.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm text-ink">{v.name}</p>
                {v.externalRef && <p className="text-xs text-slate-500">{t('Ref {ref}', { ref: v.externalRef })}</p>}
              </div>
              {readOnly ? (
                <Badge tone={v.allowed ? 'ok' : 'bad'}>{v.allowed ? t('Authorized') : t('Not authorized')}</Badge>
              ) : (
                <Toggle label={v.allowed ? t('Authorized') : t('Not authorized')} checked={v.allowed} disabled={save.isPending} onChange={(allowed) => save.mutate({ id: v.id, name: v.name, allowed, externalRef: v.externalRef ?? null }, { onError: (err) => toast.error(errorMessage(err)) })} />
              )}
            </li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <form onSubmit={add} className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <TextField label={t('Add a vendor')} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('e.g. Acme Cloud Services')} maxLength={120} />
          </div>
          <Button type="submit" icon={<Plus className="size-4" aria-hidden />} disabled={name.trim().length < 2} loading={save.isPending && !save.variables?.id}>
            {t('Add vendor')}
          </Button>
        </form>
      )}
      {error && <InlineAlert>{error}</InlineAlert>}
    </div>
  );
}

/* ───────────────────────── agreements ───────────────────────── */

export function AgreementsPanel({ currency, readOnly }: { currency: string; readOnly?: boolean }) {
  const agreements = useAgreements();
  const vendors = useVendors();
  const save = useSaveAgreement();
  const toast = useToast();
  const [vendorId, setVendorId] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [tolerance, setTolerance] = useState<number | null>(0);
  const [frequency, setFrequency] = useState<(typeof AGREEMENT_FREQUENCIES)[number]>('MONTHLY');
  const [concept, setConcept] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);

  if (agreements.isLoading || vendors.isLoading) return <Skeleton className="h-32" />;
  if (agreements.isError) return <ErrorState error={agreements.error} onRetry={() => void agreements.refetch()} />;
  const list = agreements.data ?? [];
  const vs = vendors.data ?? [];
  const nameOf = (id: string, fallback?: string | null) => fallback ?? vs.find((v) => v.id === id)?.name ?? id;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!vendorId || !amount) return;
    save.mutate(
      { vendorId, currency, amountMinor: amount, toleranceMinor: tolerance ?? 0, frequency, concept: concept.trim(), active: true },
      {
        onSuccess: () => { toast.success(t('Agreement saved.')); setAmount(null); setTolerance(0); setConcept(''); setFormKey((k) => k + 1); },
        onError: (err) => setError(errorMessage(err)),
      },
    );
  };

  return (
    <div className="space-y-4">
      {list.length === 0 ? (
        <EmptyState title={t('No agreements yet')} body={t('An agreement says what a vendor normally charges, so Oli can spot discrepancies.')} />
      ) : (
        <ul className="divide-y divide-hairline rounded-lg ring-1 ring-hairline">
          {list.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm text-ink">{nameOf(a.vendorId, a.vendorName)}</p>
                <p className="text-xs text-slate-500">
                  {formatMoney(a.amountMinor, a.currency)} · {freqLabel(a.frequency)}
                  {a.toleranceMinor > 0 && ` · ±${formatMoney(a.toleranceMinor, a.currency)}`}
                  {a.concept && ` · ${a.concept}`}
                </p>
              </div>
              {readOnly ? (
                <Badge tone={a.active ? 'ok' : 'muted'}>{a.active ? t('Active') : t('Inactive')}</Badge>
              ) : (
                <Toggle label={a.active ? t('Active') : t('Inactive')} checked={a.active} disabled={save.isPending} onChange={(active) => save.mutate({ id: a.id, vendorId: a.vendorId, currency: a.currency, amountMinor: a.amountMinor, toleranceMinor: a.toleranceMinor, frequency: a.frequency as (typeof AGREEMENT_FREQUENCIES)[number], concept: a.concept ?? null, active }, { onError: (err) => toast.error(errorMessage(err)) })} />
              )}
            </li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <form key={formKey} onSubmit={submit} className="grid gap-3 rounded-lg bg-slate-50 p-4 sm:grid-cols-2">
          <h3 className="text-sm text-ink sm:col-span-2">{t('Add an agreement')}</h3>
          <SelectField label={t('Vendor')} value={vendorId} onChange={(e) => setVendorId(e.target.value)} required>
            <option value="">{t('Choose a vendor…')}</option>
            {vs.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </SelectField>
          <SelectField label={t('Frequency')} value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)}>
            {AGREEMENT_FREQUENCIES.map((f) => <option key={f} value={f}>{freqLabel(f)}</option>)}
          </SelectField>
          <MoneyField label={t('Agreed amount')} currency={currency} valueMinor={amount} onChange={setAmount} />
          <MoneyField label={t('Tolerance')} currency={currency} valueMinor={tolerance} onChange={setTolerance} hint={t('How far an invoice may differ and still match.')} />
          <div className="sm:col-span-2">
            <TextField label={t('Concept')} required value={concept} onChange={(e) => setConcept(e.target.value)} maxLength={200} placeholder={t('e.g. Cloud hosting')} />
          </div>
          {error && <div className="sm:col-span-2"><InlineAlert>{error}</InlineAlert></div>}
          <div className="sm:col-span-2">
            <Button type="submit" icon={<Plus className="size-4" aria-hidden />} disabled={!vendorId || !amount || !concept.trim()} loading={save.isPending && !save.variables?.id}>
              {t('Save agreement')}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

/* ───────────────────────── sample set (onboarding) ───────────────────────── */

export function SampleSetButton({ currency, onDone }: { currency: string; onDone?: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      const existing = await api.listVendors();
      const agreements = await api.listAgreements();
      for (const s of SAMPLE_VENDOR_SET) {
        const vendor = existing.find((v) => v.name === s.name) ?? (await api.saveVendor({ name: s.name, allowed: s.allowed }));
        if (!agreements.some(a => a.vendorId === vendor.id && a.currency === currency && a.concept === s.agreement.concept && a.frequency === s.agreement.frequency)) {
          await api.saveAgreement({ vendorId: vendor.id, currency, ...s.agreement, active: true });
        }
      }
      await Promise.all([qc.invalidateQueries({ queryKey: qk.vendors }), qc.invalidateQueries({ queryKey: qk.agreements })]);
      toast.success(t('Sample vendors and agreements loaded.'));
      onDone?.();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="secondary" loading={busy} icon={<Sparkles className="size-4" aria-hidden />} onClick={() => void load()}>
      {t('Load fictitious sample set')}
    </Button>
  );
}
