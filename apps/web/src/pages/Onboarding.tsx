import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  FileCheck,
  FileUp,
  ShieldCheck,
  UploadCloud,
} from 'lucide-react';
import { api, errorMessage } from '@/api';
import sampleInvoiceUrl from '../../../../examples/invoices/hosting.pdf?url';
import { DemoBanner } from '@/components/DemoBanner';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { Logo } from '@/components/Logo';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import type { OliState } from '@/components/Oli';
import { Button } from '@/components/ui/Button';
import { ErrorState, InlineAlert, PageLoading } from '@/components/ui/Card';
import { Checkbox, SelectField, TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import type { InvoiceSummary, MandateDraftInput } from '@/contracts';
import { AgreementsPanel, SampleSetButton, VendorsPanel } from '@/features/rules/ReferenceData';
import { emptyMandate, hasErrors, MandateForm, validateMandate } from '@/features/rules/MandateForm';
import { MandateSummary, toDraftInput } from '@/features/rules/MandateSummary';
import { validateFile } from '@/features/invoices/useUploadQueue';
import { qk, useActivateMandate, useAgreements, useMandate, useMe, useSaveMandateDraft, useVendors } from '@/hooks/queries';
import { t } from '@/i18n';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/money';
import { OliGuide } from '@/features/onboarding/OliGuide';
import { RULE_SECTIONS, VENDOR_SECTIONS } from '@/features/onboarding/sections';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import '@/styles/onboarding.css';

// English source labels (i18n keys) — translated at render time.
const STEPS = ['Your workspace', 'Your rules', 'Your vendors', 'Your confirmation', 'Let’s try it'] as const;
const CURRENCIES = ['USD', 'EUR', 'GBP', 'MXN', 'COP'];

export function Onboarding() {
  const [params] = useSearchParams();
  const restart = params.get('restart') === '1';
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
  const [section, setSection] = useState(0);
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const [leaving, setLeaving] = useState(false);
  const leaveLock = useRef(false);
  const nextLock = useRef(false);
  const [company, setCompany] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [owner, setOwner] = useState('');
  const [draft, setDraft] = useState<MandateDraftInput | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const [oliState, setOliState] = useState<OliState | undefined>(undefined);
  const [uploading, setUploading] = useState(false);
  const [uploadedInvoice, setUploadedInvoice] = useState<InvoiceSummary | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reducedMotion = usePrefersReducedMotion();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const uploadLock = useRef(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const reactToTyping = () => {
    clearTimeout(typingTimer.current);
    setOliState('listening');
    typingTimer.current = setTimeout(() => {
      setOliState('happy');
      typingTimer.current = setTimeout(() => setOliState(undefined), 1000);
    }, 600);
  };

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
    const source = restart ? mandate.data?.active ?? mandate.data?.draft : mandate.data?.draft;
    if (source && !draft) {
      const input = toDraftInput(source);
      if (restart && mandate.data?.active) input.expectedRevision = mandate.data.draft?.revision ?? null;
      setDraft(input);
      setFormKey((k) => k + 1);
    }
  }, [mandate.data, draft, restart]);

  useEffect(() => {
    clearTimeout(typingTimer.current);
    setOliState(undefined);
    if (step > 0) headingRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: reducedMotion ? 'instant' : 'smooth' });
    return () => clearTimeout(typingTimer.current);
  }, [step, section, reducedMotion]);

  if (me.isLoading || (mandate.isLoading && !draft)) return <PageLoading />;
  if (!me.data) return <Navigate to="/login" replace />;
  if (me.data.role === 'approver') return <Navigate to="/app" replace />;
  if (mandate.isError) return <ErrorState error={mandate.error} onRetry={() => void mandate.refetch()} />;
  // Only redirect if active AND not currently going through the onboarding wizard steps 3 or 4
  if (mandate.data?.active && !restart && step < 3) return <Navigate to="/app" replace />;

  const go = (to: number, part = 0) => {
    setDirection(to * 3 + part >= step * 3 + section ? 'forward' : 'back');
    setStep(to);
    setSection(part);
    setShowErrors(false);
  };

  const next = async () => {
    if (nextLock.current || busy || activate.isPending || (step === 3 && !confirmed)) return;
    nextLock.current = true;
    setError(null);
    setBusy(true);
    try {
      if (step === 0) {
        if (!org) {
          const m = await api.createOrg({ name: company.trim(), defaultCurrency: currency, ownerName: owner.trim() });
          qc.setQueryData(qk.me, m);
        }
        setDraft((d) => d ?? emptyMandate(org?.defaultCurrency ?? currency));
        go(1);
      } else if (step === 1 && draft) {
        setShowErrors(true);
        const errors = validateMandate(draft);
        if (section === 0 && (errors.automaticLimitMinor || errors.reviewAboveMinor)) return;
        if (section === 1 && (errors.hardLimitMinor || errors.monthlyBudgetMinor)) return;
        if (section < 2) { go(1, section + 1); return; }
        if (hasErrors(errors)) { go(1, errors.automaticLimitMinor || errors.reviewAboveMinor ? 0 : 1); setShowErrors(true); return; }
        const saved = await save.mutateAsync(draft);
        setDraft(toDraftInput(saved));
        setConfirmed(false);
        go(2);
      } else if (step === 2) {
        if (section === 0) go(2, 1);
        else go(3);
      } else if (step === 3) {
        // Activate mandate and advance to optional first invoice step
        await activate.mutateAsync(save.data ?? mandate.data?.draft ?? undefined);
        qc.invalidateQueries({ queryKey: qk.mandate });
        setOliState('celebrating');
        go(4);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      nextLock.current = false;
      setBusy(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    if (uploadLock.current) return;
    const problem = validateFile(file);
    if (problem) { setError(problem); return; }
    uploadLock.current = true;
    setError(null);
    setUploading(true);
    setOliState('thinking');
    try {
      const inv = await api.uploadInvoice(file);
      setUploadedInvoice(inv);
      qc.invalidateQueries({ queryKey: qk.invoices });
      toast.success(t('Invoice uploaded! Oli is reviewing it.'));
      setOliState('celebrating');
    } catch (e) {
      setError(errorMessage(e));
      setOliState(undefined);
    } finally {
      uploadLock.current = false;
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleLoadSample = async () => {
    if (uploading) return;
    setError(null); setUploading(true);
    try {
      const response = await fetch(sampleInvoiceUrl);
      if (!response.ok) throw new Error(t('The sample invoice could not be loaded. Please try again.'));
      await handleFileUpload(new File([await response.blob()], 'demo-hosting.pdf', { type: 'application/pdf', lastModified: 0 }));
    } catch (e) {
      setError(errorMessage(e));
    } finally { setUploading(false); }
  };

  const finish = (skip = false) => {
    if (uploading || uploadLock.current || leaveLock.current) return;
    leaveLock.current = true;
    setLeaving(true);
    if (skip || !uploadedInvoice) {
      toast.success(t(restart ? 'Your updated rules are active.' : 'Oli is ready. Welcome aboard!'));
    } else {
      toast.success(t('Invoice uploaded! Oli is reviewing it.'));
    }
    // Single navigation: the browser cross-fades into the dashboard (View Transitions; plain navigation elsewhere).
    nav('/app', { replace: true, viewTransition: true });
  };

  const step0Valid = company.trim().length >= 2 && (!!org || owner.trim().length >= 2);
  const cur = draft?.currency ?? currency;
  const vendorCount = vendors.data?.filter((v) => v.allowed).length ?? 0;
  const activeAgreements = agreements.data?.filter((a) => a.active).length ?? 0;

  const titles = [
    restart ? 'Let’s revisit your workspace.' : 'A little about your team.',
    'How should we work together?',
    'Who do you work with?',
    'Does everything look right?',
    uploadedInvoice ? 'Your first invoice is in.' : 'Let’s put your rules to work.',
  ];
  const descriptions = [
    'Tell me what to call your workspace and who will be responsible for approvals.',
    'Set your limits below. I’ll check every invoice against these rules.',
    'Add authorized vendors and the agreements I should check against.',
    restart ? 'Your current rules stay active until you confirm these changes.' : 'Nothing is active until you review and confirm these rules.',
    uploadedInvoice ? 'You can follow its progress and read the decision from your dashboard.' : 'Try a sample invoice, upload a fictional one, or explore your dashboard first.',
  ];

  const parts = step === 1 ? RULE_SECTIONS : step === 2 ? VENDOR_SECTIONS : null;
  const part = parts?.[section];
  const continueLabel = step === 0 ? 'Let’s set my rules' : step === 1 ? section < 2 ? 'Continue' : 'Meet my vendors' : section === 0 ? 'Set up agreements' : 'Review my setup';

  return (
    <div className="onboarding" data-compact={!!parts || undefined} data-leaving={leaving || undefined}>
      <DemoBanner />
      <div className="onboarding-shell">
        <header className="onboarding-header">
          <Logo />
          <div className="flex flex-wrap items-center justify-end gap-3"><ThemeSwitcher compact /><LanguageSwitcher /></div>
        </header>
        {restart && (
          <Link to="/app/settings" className="mb-5 inline-flex items-center gap-2 text-sm text-ash hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden /> {t('Back to Settings')}
          </Link>
        )}
        <nav className="onboarding-progress" aria-label={t('Setup progress')}>
          <p>{t('Step {n} of {total}', { n: step + 1, total: STEPS.length })}<span>{t(STEPS[step]!)}</span></p>
          <ol>
            {STEPS.map((label, i) => (
              <li key={label} aria-current={i === step ? 'step' : undefined} className={cn(i < step && 'is-complete', i === step && 'is-current')}>
                <span className="onboarding-progress-track" aria-hidden="true" />
                <span className="onboarding-progress-label">{i < step && <Check className="size-3" aria-hidden="true" />}{t(label)}</span>
              </li>
            ))}
          </ol>
          {parts && <div className="onboarding-subprogress" aria-label={t('Section progress')}>
            <span>{t(part!.label)}</span>
            <span>{t('Part {n} of {total}', { n: section + 1, total: parts.length })}</span>
          </div>}
        </nav>

        <div className="onboarding-layout">
          <OliGuide step={step} section={section} direction={direction} state={oliState} name={owner} busy={busy || uploading} hasError={!!error} uploaded={!!uploadedInvoice} />
          <main className="onboarding-workspace" aria-busy={busy || uploading}
            onInputCapture={reactToTyping}
            onFocusCapture={(event) => { if (event.target.matches('input:not([type=checkbox]), textarea, select')) setOliState('listening'); }}
            onBlurCapture={(event) => {
              if (!(event.relatedTarget instanceof HTMLElement) || !event.relatedTarget.matches('input, textarea, select')) {
                clearTimeout(typingTimer.current);
                setOliState(undefined);
              }
            }}>
            <div className="onboarding-step" key={step} data-step={step} data-section={section} data-direction={direction}>
              <div className="onboarding-prompt oli-speech-bubble" key={`prompt-${step}-${section}`}>
                <h1 ref={headingRef} tabIndex={-1}>{t(part?.title ?? titles[step]!)}</h1>
                <p className="onboarding-description">{t(part?.body ?? descriptions[step]!)}</p>
              </div>
              <div className="onboarding-form">

              {step === 0 && (
                <form id="onboarding-workspace" className="space-y-5" onSubmit={(event) => { event.preventDefault(); if (step0Valid) void next(); }}>
                  <TextField label={t('Your name')} disabled={!!org} value={owner} onChange={(e) => setOwner(e.target.value)} placeholder={t('What should I call you?')} autoComplete="given-name" maxLength={80} required />
                  <TextField label={t('Company name')} value={company} onChange={(e) => setCompany(e.target.value)} disabled={!!org} placeholder={t('e.g. Northwind')} autoComplete="organization" maxLength={80} required />
                  <SelectField label={t('Default currency')} value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={!!org} hint={t('Budgets are kept per currency; Oli never mixes them.')}>
                    {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </SelectField>
                  <p className="onboarding-reassurance"><ShieldCheck className="size-4 shrink-0" aria-hidden="true" />{t('You’re in control. We’ll review your rules before activating anything.')}</p>
                </form>
              )}

              {step === 1 && draft && (
                <div>
                  <MandateForm key={formKey} section={RULE_SECTIONS[section]!.form} value={draft} onChange={(value) => { setDraft(value); setConfirmed(false); }} showErrors={showErrors} />
                </div>
              )}

              {step === 2 && (
                <div className="space-y-7">
                  <div hidden={section !== 0} className="onboarding-vendors-section space-y-5">
                  <div className="onboarding-sample-intro">
                    <p>{t('Want to see how it works first?')}</p>
                    <p className="mb-3 text-sm text-ash">{t('Load a ready-made set of vendors and agreements, then adjust it together.')}</p>
                    <SampleSetButton currency={cur} />
                  </div>
                  <section aria-label={t('Vendors')}><h2 className="mb-3 text-lg">{t('Vendors')}</h2><VendorsPanel compact /></section>
                  {vendorCount === 0 && !vendors.isLoading && <InlineAlert tone="warn">{t('With no authorized vendors, Oli will block every invoice. Add at least one or load the sample set.')}</InlineAlert>}
                  </div>
                  <section hidden={section !== 1} aria-label={t('Agreements')}><AgreementsPanel currency={cur} compact /></section>
                </div>
              )}

              {step === 3 && draft && (
                <div className="space-y-6">
                  <MandateSummary mandate={draft} compareTo={restart ? mandate.data?.active : null} />
                  <p className="text-sm text-ash">{vendorCount === 1 ? t('1 authorized vendor · {a} active agreements', { a: activeAgreements }) : t('{v} authorized vendors · {a} active agreements', { v: vendorCount, a: activeAgreements })}</p>
                  <div className="onboarding-confirmation">
                    <Checkbox checked={confirmed} onChange={(value) => { setConfirmed(value); setOliState(value ? 'happy' : undefined); }} label={t('I confirm these rules.')} description={t(restart ? 'These rules will replace your current rules. Previous decisions keep their history.' : 'This creates policy version 1. You can change it later; old versions are kept for the audit trail.')} />
                  </div>
                </div>
              )}

              {step === 4 && (
                <div className="space-y-6">
                  <p className="onboarding-activated"><CheckCircle2 className="size-4" aria-hidden="true" />{t('Mandate activated')}</p>
                  {!uploadedInvoice ? (
                    <>
                      <div onDragOver={(e) => { e.preventDefault(); if (!uploading) setIsDragOver(true); }} onDragLeave={() => setIsDragOver(false)} onDrop={(e) => { e.preventDefault(); setIsDragOver(false); if (!uploading && e.dataTransfer.files?.[0]) void handleFileUpload(e.dataTransfer.files[0]); }}
                        className={cn('onboarding-dropzone', isDragOver && 'is-dragging', uploading && 'is-uploading')}>
                        <input ref={fileInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg" className="sr-only" tabIndex={-1} aria-label={t('Upload invoice')} disabled={uploading} onChange={(e) => { if (e.target.files?.[0]) void handleFileUpload(e.target.files[0]); }} />
                        <UploadCloud className="mb-3 size-8" aria-hidden="true" />
                        <p>{t('Drop an invoice here. I’ll take a look.')}</p>
                        <p className="mt-2 text-xs text-ash">{t('Supports PDF, PNG, JPG up to 5 MB')}</p>
                        <Button className="mt-5" variant="secondary" icon={<FileUp className="size-4" aria-hidden="true" />} loading={uploading} onClick={() => fileInputRef.current?.click()}>{t('Browse file')}</Button>
                      </div>
                      <div className="onboarding-sample-invoice">
                        <FileCheck className="size-5 shrink-0" aria-hidden="true" />
                        <div><p className="text-sm">{t('No invoice handy? Try this one.')}</p><p className="mt-1 text-xs text-ash">{t('Demo Cloud Hosting · USD 200 · PDF')}</p></div>
                        <Button variant="ghost" size="sm" loading={uploading} onClick={() => void handleLoadSample()}>{t('Try sample')}</Button>
                      </div>
                    </>
                  ) : (
                    <div className="onboarding-uploaded" role="status">
                      <FileCheck className="size-7 shrink-0" aria-hidden="true" />
                      <div className="min-w-0"><p className="break-words text-base">{uploadedInvoice.fileName}</p><p className="mt-1 text-sm text-ash">{uploadedInvoice.vendorName || t('Vendor pending extraction')}{uploadedInvoice.amountMinor != null && ` · ${formatMoney(uploadedInvoice.amountMinor, uploadedInvoice.currency)}`}</p><p className="mt-3 text-sm">{t('Invoice received. Follow its checks and decision on your dashboard.')}</p></div>
                    </div>
                  )}
                  <p className="text-sm leading-relaxed text-ash">{t('Next, your dashboard: invoices, decisions and anything that needs your attention. You can also ask me in chat.')}</p>
                </div>
              )}
              </div>
            </div>

            {error && <div className="mt-5"><InlineAlert>{error}</InlineAlert></div>}
            <footer className="onboarding-actions">
              {step === 4 ? (
                <><Button variant="ghost" onClick={() => finish(true)} disabled={uploading || leaving}>{t('Do this later')}</Button><Button onClick={() => finish()} loading={uploading} disabled={leaving} icon={<ArrowRight className="size-4" aria-hidden="true" />}>{t('Let’s go to my dashboard')}</Button></>
              ) : (
                <>
                  {step > 0 ? <Button variant="ghost" icon={<ArrowLeft className="size-4" aria-hidden="true" />} disabled={busy || activate.isPending} onClick={() => { setError(null); if (section > 0) go(step, section - 1); else go(step - 1, step === 2 ? 2 : step === 3 ? 1 : 0); }}>{t('Back')}</Button> : <span className="text-xs text-ash">{t('We’ll take it one step at a time.')}</span>}
                  {step < 3 ? <Button type={step === 0 ? 'submit' : 'button'} form={step === 0 ? 'onboarding-workspace' : undefined} loading={busy} disabled={step === 0 && !step0Valid} onClick={step === 0 ? undefined : () => void next()} icon={<ArrowRight className="size-4" aria-hidden="true" />}>{t(continueLabel)}</Button> : <Button icon={confirmed ? <ShieldCheck className="size-4" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />} disabled={!confirmed} loading={busy || activate.isPending} onClick={() => void next()}>{t(restart ? 'Save rules & continue' : 'Activate my rules')}</Button>}
                </>
              )}
            </footer>
          </main>
        </div>
      </div>
    </div>
  );
}
