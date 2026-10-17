import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, ShieldCheck } from 'lucide-react';
import { api, errorMessage } from '@/api';
import { DemoBanner } from '@/components/DemoBanner';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/Button';
import { Card, InlineAlert, PageLoading } from '@/components/ui/Card';
import { Checkbox, SelectField, TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import type { MandateDraftInput } from '@/contracts';
import { AgreementsPanel, SampleSetButton, VendorsPanel } from '@/features/rules/ReferenceData';
import { emptyMandate, hasErrors, MandateForm, validateMandate } from '@/features/rules/MandateForm';
import { MandateSummary, toDraftInput } from '@/features/rules/MandateSummary';
import { qk, useActivateMandate, useAgreements, useMandate, useMe, useSaveMandateDraft, useVendors } from '@/hooks/queries';
import { t } from '@/i18n';
import { cn } from '@/lib/cn';

// English source labels (i18n keys) — translated at render time.
const STEPS = ['Meet Oli', 'Your mandate', 'Who can be paid', 'Review & activate'] as const;
const CURRENCIES = ['USD', 'EUR', 'GBP', 'MXN', 'COP'];

export function Onboarding() {
  const me = useMe();
  const mandate = useMandate(!!me.data?.org);
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const save = useSaveMandateDraft();
  const activate = useActivateMandate();
  const vendors = useVendors(!!me.data?.org);
  const agreements = useAgreements(!!me.data?.org);

  const [step, setStep] = useState(0);
  const [company, setCompany] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [owner, setOwner] = useState('');
  const [draft, setDraft] = useState<MandateDraftInput | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const org = me.data?.org;
  // Prefill from the server (existing org, or a saved draft → resume where the user left off).
  useEffect(() => {
    if (org) {
      setCompany(org.name);
      setCurrency(org.defaultCurrency);
    }
    if (me.data?.user.name) setOwner((o) => o || me.data!.user.name!);
  }, [org, me.data]);
  useEffect(() => {
    if (mandate.data?.draft && !draft) {
      setDraft(toDraftInput(mandate.data.draft));
      setFormKey((k) => k + 1);
    }
  }, [mandate.data, draft]);

  if (me.isLoading) return <PageLoading />;
  if (!me.data) return <Navigate to="/login" replace />;
  if (me.data.role === 'approver') return <Navigate to="/app" replace />;
  if (mandate.data?.active) return <Navigate to="/app" replace />;

  const next = async () => {
    setError(null);
    setBusy(true);
    try {
      if (step === 0) {
        if (!org) {
          const m = await api.createOrg({ name: company.trim(), defaultCurrency: currency, ownerName: owner.trim() });
          qc.setQueryData(qk.me, m);
        }
        setDraft((d) => d ?? emptyMandate(org?.defaultCurrency ?? currency));
        setStep(1);
      } else if (step === 1 && draft) {
        setShowErrors(true);
        if (hasErrors(validateMandate(draft))) return;
        const saved = await save.mutateAsync(draft);
        setDraft(toDraftInput(saved));
        setStep(2);
      } else if (step === 2) {
        setStep(3);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setError(null);
    try {
      await activate.mutateAsync(save.data ?? mandate.data?.draft ?? undefined);
      toast.success(t('Oli is ready. Upload your first invoice.'));
      nav('/app/bills', { replace: true });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const step0Valid = company.trim().length >= 2 && owner.trim().length >= 2;
  const cur = draft?.currency ?? currency;
  const vendorCount = vendors.data?.filter((v) => v.allowed).length ?? 0;
  const activeAgreements = agreements.data?.filter((a) => a.active).length ?? 0;

  return (
    <div className="flex min-h-screen flex-col">
      <DemoBanner />
      <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
        <div className="mb-8 flex items-center justify-between">
          <Logo />
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <span className="caption">{t('Step {n} of {total}', { n: step + 1, total: STEPS.length })}</span>
          </div>
        </div>

        <ol className="mb-8 flex gap-2" aria-label={t('Setup progress')}>
          {STEPS.map((s, i) => (
            <li key={s} className="flex-1" aria-current={i === step ? 'step' : undefined}>
              <span className={cn('block h-1.5 rounded-sm', i < step ? 'bg-ink' : i === step ? 'bg-highlighter ring-1 ring-inset ring-ink' : 'bg-smoke')} />
              <span className={cn('mt-1.5 hidden text-xs sm:block', i === step ? 'text-ink' : 'text-ash')}>{t(s)}</span>
            </li>
          ))}
        </ol>

        <Card className="p-6 sm:p-8">
          {step === 0 && (
            <div className="space-y-5">
              <div>
                <h1 className="text-[40px] leading-[1.05]">{t('Meet Oli')}</h1>
                <p className="mt-2 text-base text-ash">{t('Tell Oli about your (fictitious) company. Use made-up names — this is a demo.')}</p>
              </div>
              <TextField label={t('Company name')} value={company} onChange={(e) => setCompany(e.target.value)} disabled={!!org} placeholder={t('e.g. Northwind Demo Co.')} maxLength={80} />
              <SelectField label={t('Default currency')} value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={!!org} hint={t('Budgets are kept per currency; Oli never mixes them.')}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </SelectField>
              <TextField label={t('Your name')} value={owner} onChange={(e) => setOwner(e.target.value)} placeholder={t('Who is responsible for approvals?')} maxLength={80} />
            </div>
          )}

          {step === 1 && draft && (
            <div className="space-y-5">
              <div>
                <h1 className="text-[40px] leading-[1.05]">{t('Your mandate')}</h1>
                <p className="mt-2 text-base text-ash">{t('What may Oli approve on its own, and when should it ask you?')}</p>
              </div>
              <MandateForm key={formKey} value={draft} onChange={setDraft} showErrors={showErrors} />
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <div>
                <h1 className="text-[40px] leading-[1.05]">{t('Who can be paid')}</h1>
                <p className="mt-2 text-base text-ash">{t('Authorized vendors and what they normally charge. You can change this any time.')}</p>
              </div>
              <SampleSetButton currency={cur} />
              <section aria-label={t('Vendors')}><h2 className="mb-2 text-base">{t('Vendors')}</h2><VendorsPanel /></section>
              <section aria-label={t('Agreements')}><h2 className="mb-2 text-base">{t('Agreements')}</h2><AgreementsPanel currency={cur} /></section>
              {vendorCount === 0 && !vendors.isLoading && (
                <InlineAlert tone="warn">{t('With no authorized vendors, Oli will block every invoice. Add at least one or load the sample set.')}</InlineAlert>
              )}
            </div>
          )}

          {step === 3 && draft && (
            <div className="space-y-5">
              <div>
                <h1 className="text-[40px] leading-[1.05]">{t('Review & activate')}</h1>
                <p className="mt-2 text-base text-ash">{t('These are the exact rules Oli will follow. Nothing is active until you confirm.')}</p>
              </div>
              <MandateSummary mandate={draft} />
              <p className="text-sm text-ash">
                {vendorCount === 1
                  ? t('1 authorized vendor · {a} active agreements', { a: activeAgreements })
                  : t('{v} authorized vendors · {a} active agreements', { v: vendorCount, a: activeAgreements })}
              </p>
              <Checkbox checked={confirmed} onChange={setConfirmed} label={t('I confirm these rules.')} description={t('This creates policy version 1. You can change it later; old versions are kept for the audit trail.')} />
            </div>
          )}

          {error && <div className="mt-5"><InlineAlert>{error}</InlineAlert></div>}

          <div className="mt-10 flex items-center justify-between">
            <Button variant="ghost" icon={<ArrowLeft className="size-4" aria-hidden />} disabled={step === 0 || busy || activate.isPending} onClick={() => { setError(null); setStep((s) => s - 1); }}>
              {t('Back')}
            </Button>
            {step < 3 ? (
              <Button loading={busy} disabled={step === 0 && !step0Valid} onClick={() => void next()}>
                {t('Continue')} <ArrowRight className="size-4" aria-hidden />
              </Button>
            ) : (
              <Button beam icon={confirmed ? <ShieldCheck className="size-4" aria-hidden /> : <Check className="size-4" aria-hidden />} disabled={!confirmed} loading={activate.isPending} onClick={() => void finish()}>
                {t('Activate Oli')}
              </Button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
