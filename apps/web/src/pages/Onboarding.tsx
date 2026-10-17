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
  Sparkles,
  UploadCloud,
  Zap,
} from 'lucide-react';
import { api, errorMessage } from '@/api';
import sampleInvoiceUrl from '../../../../examples/invoices/hosting.pdf?url';
import { DemoBanner } from '@/components/DemoBanner';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { Logo } from '@/components/Logo';
import { Oli, type OliState } from '@/components/Oli';
import { Beam } from '@/components/ui/Beam';
import { Button } from '@/components/ui/Button';
import { Card, ErrorState, InlineAlert, PageLoading } from '@/components/ui/Card';
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

// English source labels (i18n keys) — translated at render time.
const STEPS = ['Meet Oli', 'Your mandate', 'Who can be paid', 'Review & activate', 'First invoice'] as const;
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
  const [company, setCompany] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [owner, setOwner] = useState('');
  const [draft, setDraft] = useState<MandateDraftInput | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  // WOW elements & optional invoice upload
  const [oliState, setOliState] = useState<OliState>('idle');
  const [uploading, setUploading] = useState(false);
  const [uploadedInvoice, setUploadedInvoice] = useState<InvoiceSummary | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Scroll to the top of the page when changing steps (clicking Continue or Back)
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
    document.documentElement.scrollTo?.({ top: 0, left: 0, behavior: 'smooth' });
    document.body.scrollTo?.({ top: 0, left: 0, behavior: 'smooth' });
  }, [step]);

  if (me.isLoading || mandate.isLoading) return <PageLoading />;
  if (!me.data) return <Navigate to="/login" replace />;
  if (me.data.role === 'approver') return <Navigate to="/app" replace />;
  if (mandate.isError) return <ErrorState error={mandate.error} onRetry={() => void mandate.refetch()} />;
  // Only redirect if active AND not currently going through the onboarding wizard steps 3 or 4
  if (mandate.data?.active && !restart && step < 3) return <Navigate to="/app" replace />;

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
        setConfirmed(false);
        setStep(2);
      } else if (step === 2) {
        setStep(3);
      } else if (step === 3) {
        // Activate mandate and advance to optional first invoice step
        await activate.mutateAsync(save.data ?? mandate.data?.draft ?? undefined);
        qc.invalidateQueries({ queryKey: qk.mandate });
        setOliState('celebrating');
        setStep(4);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    const problem = validateFile(file);
    if (problem) { setError(problem); return; }
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
      setOliState('idle');
    } finally {
      setUploading(false);
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
    if (skip || !uploadedInvoice) {
      toast.success(t(restart ? 'Your updated rules are active.' : 'Oli is ready. Welcome aboard!'));
    } else {
      toast.success(t('Invoice uploaded! Oli is reviewing it.'));
    }
    nav('/app', { replace: true });
  };

  const step0Valid = company.trim().length >= 2 && (!!org || owner.trim().length >= 2);
  const cur = draft?.currency ?? currency;
  const vendorCount = vendors.data?.filter((v) => v.allowed).length ?? 0;
  const activeAgreements = agreements.data?.filter((a) => a.active).length ?? 0;

  return (
    <div className="flex min-h-screen flex-col bg-bone/30">
      <DemoBanner />
      <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:py-10">
        {restart && (
          <Link to="/app/settings" className="mb-5 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden /> {t('Back to Settings')}
          </Link>
        )}
        <div className="mb-6 flex items-center justify-between sm:mb-8">
          <Logo />
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <span className="caption text-slate-500">{t('Step {n} of {total}', { n: step + 1, total: STEPS.length })}</span>
          </div>
        </div>

        <ol className="mb-8 flex gap-2" aria-label={t('Setup progress')}>
          {STEPS.map((s, i) => (
            <li key={s} className="flex-1" aria-current={i === step ? 'step' : undefined}>
              <span className={cn('block h-1.5 rounded-sm transition-all', i < step ? 'bg-ink' : i === step ? 'bg-highlighter ring-1 ring-inset ring-ink' : 'bg-smoke')} />
              <span className={cn('mt-1.5 hidden text-xs sm:block', i === step ? 'font-medium text-ink' : 'text-ash')}>{t(s)}</span>
            </li>
          ))}
        </ol>

        <Card className="relative overflow-hidden p-6 sm:p-8 shadow-sm">
          {/* STEP 0: Bienvenida WOW */}
          {step === 0 && (
            <div className="space-y-6">
              <div className="flex flex-col items-center text-center">
                {/* Animated Oli Mascot Hero */}
                <div className="relative mb-3 flex size-[120px] items-center justify-center sm:size-[130px]">
                  <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-highlighter/35 via-amber-200/25 to-slate-200/40 blur-2xl pointer-events-none" />
                  <Oli
                    state={oliState}
                    dark={false}
                    speed={0.8}
                    particles={1800}
                    size={130}
                    label={t('Oli Assistant')}
                  />
                </div>

                {/* Welcoming Interactive Pill */}
                <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-hairline bg-white/95 px-3.5 py-1 text-xs text-ink shadow-xs transition-all">
                  <Sparkles className="size-3.5 text-highlighter shrink-0" />
                  <span>
                    {owner.trim()
                      ? t('Nice to meet you, {name}!', { name: owner.trim() })
                      : t('Your autonomous finance policy engine')}
                  </span>
                </div>

                <h1 className="text-3xl font-medium tracking-tight text-ink sm:text-[38px] leading-tight">
                  {t(restart ? 'Update your setup' : 'Meet Oli')}
                </h1>
                <p className="mt-2 max-w-md text-sm text-slate-500 sm:text-base leading-relaxed">
                  {t(restart ? 'Review your company setup and update the rules Oli uses for your invoices.' : 'Tell Oli about your company and set up autonomous financial governance in minutes.')}
                </p>
              </div>

              {/* 3 Core Pillars (Visual WOW Highlights) */}
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                <div className="flex flex-col items-center sm:items-start rounded-xl border border-hairline bg-bone/50 p-3 text-center sm:text-left transition-all hover:bg-bone">
                  <div className="flex size-7 items-center justify-center rounded-lg bg-ink text-white mb-2 shadow-xs">
                    <ShieldCheck className="size-4" aria-hidden />
                  </div>
                  <p className="text-xs font-medium text-ink">{t('Zero false approvals')}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500 leading-snug">{t('Strict policy validation on every invoice.')}</p>
                </div>
                <div className="flex flex-col items-center sm:items-start rounded-xl border border-hairline bg-bone/50 p-3 text-center sm:text-left transition-all hover:bg-bone">
                  <div className="flex size-7 items-center justify-center rounded-lg bg-highlighter text-ink ring-1 ring-inset ring-ink/20 mb-2 shadow-xs">
                    <Zap className="size-4" aria-hidden />
                  </div>
                  <p className="text-xs font-medium text-ink">{t('Pure autonomy')}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500 leading-snug">{t('Approves within mandate, escalates what needs you.')}</p>
                </div>
                <div className="flex flex-col items-center sm:items-start rounded-xl border border-hairline bg-bone/50 p-3 text-center sm:text-left transition-all hover:bg-bone">
                  <div className="flex size-7 items-center justify-center rounded-lg bg-white text-ink border border-hairline mb-2 shadow-xs">
                    <FileCheck className="size-4" aria-hidden />
                  </div>
                  <p className="text-xs font-medium text-ink">{t('Full audit trail')}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500 leading-snug">{t('Append-only logs for every single action.')}</p>
                </div>
              </div>

              {/* Step 0 Form inputs */}
              <div className="space-y-4 pt-2">
                <TextField
                  label={t('Company name')}
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  onFocus={() => setOliState('listening')}
                  onBlur={() => setOliState('idle')}
                  disabled={!!org}
                  placeholder={t('e.g. Northwind')}
                  maxLength={80}
                />
                <SelectField
                  label={t('Default currency')}
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  onFocus={() => setOliState('listening')}
                  onBlur={() => setOliState('idle')}
                  disabled={!!org}
                  hint={t('Budgets are kept per currency; Oli never mixes them.')}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </SelectField>
                <TextField
                  label={t('Your name')}
                  disabled={!!org}
                  value={owner}
                  onChange={(e) => setOwner(e.target.value)}
                  onFocus={() => setOliState('listening')}
                  onBlur={() => setOliState('idle')}
                  placeholder={t('Who is responsible for approvals?')}
                  maxLength={80}
                />
              </div>
            </div>
          )}

          {/* STEP 1: Mandate */}
          {step === 1 && draft && (
            <div className="space-y-5">
              <div>
                <h1 className="text-[34px] sm:text-[40px] leading-[1.05] tracking-tight">{t('Your mandate')}</h1>
                <p className="mt-2 text-base text-ash">{t('What may Oli approve on its own, and when should it ask you?')}</p>
              </div>
              <MandateForm key={formKey} value={draft} onChange={setDraft} showErrors={showErrors} />
            </div>
          )}

          {/* STEP 2: Reference data */}
          {step === 2 && (
            <div className="space-y-6">
              <div>
                <h1 className="text-[34px] sm:text-[40px] leading-[1.05] tracking-tight">{t('Who can be paid')}</h1>
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

          {/* STEP 3: Review & activate */}
          {step === 3 && draft && (
            <div className="space-y-5">
              <div>
                <h1 className="text-[34px] sm:text-[40px] leading-[1.05] tracking-tight">{t('Review & activate')}</h1>
                <p className="mt-2 text-base text-ash">{t(restart ? 'Your current rules stay active until you confirm these changes.' : 'These are the exact rules Oli will follow. Nothing is active until you confirm.')}</p>
              </div>
              <MandateSummary mandate={draft} compareTo={restart ? mandate.data?.active : null} />
              <p className="text-sm text-ash">
                {vendorCount === 1
                  ? t('1 authorized vendor · {a} active agreements', { a: activeAgreements })
                  : t('{v} authorized vendors · {a} active agreements', { v: vendorCount, a: activeAgreements })}
              </p>
              <Checkbox checked={confirmed} onChange={setConfirmed} label={t('I confirm these rules.')} description={t(restart ? 'These rules will replace your current rules. Previous decisions keep their history.' : 'This creates policy version 1. You can change it later; old versions are kept for the audit trail.')} />
            </div>
          )}

          {/* STEP 4: First invoice (Opcional) */}
          {step === 4 && (
            <div className="space-y-6">
              <div className="flex flex-col items-center text-center">
                <div className="relative mb-3 flex size-[110px] items-center justify-center">
                  <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-emerald-100/50 via-highlighter/30 to-slate-100 blur-xl pointer-events-none" />
                  <Oli
                    state={uploadedInvoice ? 'celebrating' : uploading ? 'thinking' : 'idle'}
                    dark={false}
                    speed={0.8}
                    particles={1600}
                    size={110}
                    label={t('Oli Assistant')}
                  />
                </div>

                <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800">
                  <CheckCircle2 className="size-3.5 text-emerald-600" aria-hidden />
                  <span>{t('Mandate activated')}</span>
                </div>

                <h1 className="text-2xl sm:text-3xl font-medium tracking-tight text-ink">
                  {t(restart ? 'Upload an invoice (optional)' : 'Upload your first invoice (optional)')}
                </h1>
                <p className="mt-1.5 max-w-md text-sm text-slate-500">
                  {t('Test Oli right away with an invoice, or skip and do it later.')}
                </p>
              </div>

              {/* Upload Dropzone */}
              {!uploadedInvoice ? (
                <div
                  onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                  onDragLeave={() => setIsDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragOver(false);
                    if (e.dataTransfer.files?.[0]) {
                      void handleFileUpload(e.dataTransfer.files[0]);
                    }
                  }}
                  className={cn(
                    'relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition-all',
                    isDragOver ? 'border-ink bg-highlighter/10 ring-2 ring-highlighter' : 'border-hairline bg-bone/40 hover:border-slate-400 hover:bg-bone/70',
                    uploading && 'pointer-events-none opacity-60'
                  )}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files?.[0]) {
                        void handleFileUpload(e.target.files[0]);
                      }
                    }}
                  />

                  <div className="flex size-12 items-center justify-center rounded-full bg-white shadow-xs border border-hairline mb-3">
                    <UploadCloud className="size-6 text-slate-600" aria-hidden />
                  </div>

                  <p className="text-sm font-medium text-ink">
                    {t('Drag and drop your invoice here, or browse')}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {t('Supports PDF, PNG, JPG up to 5 MB')}
                  </p>

                  <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      icon={<FileUp className="size-3.5" aria-hidden />}
                      loading={uploading}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {t('Browse file')}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      icon={<Sparkles className="size-3.5 text-highlighter" aria-hidden />}
                      loading={uploading}
                      onClick={() => void handleLoadSample()}
                    >
                      {t('Load sample invoice (Demo Cloud Hosting · USD 200)')}
                    </Button>
                  </div>
                </div>
              ) : (
                /* Invoice Uploaded Preview Card */
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5 transition-all">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-xs">
                        <FileCheck className="size-5" aria-hidden />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-ink">{uploadedInvoice.fileName}</p>
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800">
                            {t('Invoice received')}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 mt-0.5">
                          {uploadedInvoice.vendorName || t('Vendor pending extraction')}
                          {uploadedInvoice.amountMinor != null && ` · ${formatMoney(uploadedInvoice.amountMinor, uploadedInvoice.currency)}`}
                        </p>
                      </div>
                    </div>
                  </div>
                  <p className="mt-3 border-t border-emerald-200/60 pt-2.5 text-xs text-emerald-800">
                    {t('Oli policy engine is extracting data and verifying rules in real time.')}
                  </p>
                </div>
              )}

              {/* Action Buttons for Step 4 */}
              <div className="pt-2 flex flex-col-reverse sm:flex-row items-center justify-between gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => finish(true)}
                  disabled={uploading}
                >
                  {t('Skip for now')}
                </Button>

                <Beam>
                  <Button
                    type="button"
                    loading={uploading}
                    onClick={() => finish(false)}
                    icon={<ArrowRight className="size-4" aria-hidden />}
                  >
                    {uploadedInvoice ? t('Go to dashboard') : t('Go to dashboard')}
                  </Button>
                </Beam>
              </div>
            </div>
          )}

          {error && <div className="mt-5"><InlineAlert>{error}</InlineAlert></div>}

          {/* Navigation Bar for Steps 0 to 3 */}
          {step < 4 && (
            <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-6">
              <Button
                variant="ghost"
                icon={<ArrowLeft className="size-4" aria-hidden />}
                disabled={step === 0 || busy || activate.isPending}
                onClick={() => {
                  setError(null);
                  setStep((s) => s - 1);
                }}
              >
                {t('Back')}
              </Button>

              {step < 3 ? (
                <Button
                  loading={busy}
                  disabled={step === 0 && !step0Valid}
                  onClick={() => void next()}
                  icon={<ArrowRight className="size-4" aria-hidden />}
                >
                  {t('Continue')}
                </Button>
              ) : (
                <Button
                  beam
                  icon={confirmed ? <ShieldCheck className="size-4" aria-hidden /> : <Check className="size-4" aria-hidden />}
                  disabled={!confirmed}
                  loading={activate.isPending}
                  onClick={() => void next()}
                >
                  {t(restart ? 'Save rules & continue' : 'Activate & continue')}
                </Button>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
