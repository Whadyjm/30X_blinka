import { useEffect, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  ArrowRight,
  ArrowUp,
  Ban,
  CalendarClock,
  CheckCircle2,
  FileText,
  Hand,
  Paperclip,
  RotateCcw,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { Oli, type OliState } from '@/components/Oli';
import { OutcomeBadge } from '@/components/Badges';
import { buttonClass } from '@/components/ui/Button';
import { Beam } from '@/components/ui/Beam';
import { Card, CardHeader, EmptyState, ErrorState, Skeleton } from '@/components/ui/Card';
import { brand } from '@/config/brand';
import { UPLOAD } from '@/config/env';
import { useApprovals, useInvoices, useMandate, useMe } from '@/hooks/queries';
import { t } from '@/i18n';
import { buildBriefing, computeStats } from '@/lib/briefing';
import { dueLabel, isOverdue } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { getOutcome } from '@/lib/outcome';
import { InvoiceList, invoiceTitle } from '@/features/invoices/InvoiceList';
import { InboxPreview } from '@/features/integrations/InboxPreview';
import { useUploadQueue } from '@/features/invoices/useUploadQueue';
import { cn } from '@/lib/cn';

interface ChatTurn {
  id: string;
  kind: 'user' | 'assistant';
  text?: string;
  files?: { name: string; size: number }[];
  isPending?: boolean;
  contentNode?: ReactNode;
}

const HINTS = [
  '¿Qué facturas necesitan mi revisión?',
  '¿Cómo va el presupuesto de este mes?',
  '¿Qué facturas vencen en los próximos 14 días?',
  '¿Hay facturas bloqueadas o duplicadas?',
  'Arrastra una factura aquí para evaluarla…',
];

const SUGGESTIONS = [
  { label: '📋 Facturas por revisar', query: '¿Qué facturas necesitan mi revisión?' },
  { label: '💰 Estado del presupuesto', query: '¿Cómo va el presupuesto de este mes?' },
  { label: '⏰ Próximos vencimientos', query: '¿Qué facturas vencen en los próximos 14 días?' },
  { label: '🚫 Facturas bloqueadas', query: '¿Hay facturas bloqueadas o rechazadas?' },
];

function intentFor(text: string) {
  const s = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/\b(atencion|pendiente|revis|aproba|aprobar|autoriza)\b/.test(s)) return 'review';
  if (/\b(presupuesto|budget|gaste|saldo|limite|disponible)\b/.test(s)) return 'budget';
  if (/\b(vence|vencen|vencimiento|proximas|fechas|dias)\b/.test(s)) return 'due';
  if (/\b(bloquead|duplicad|rechazad|invalida|rechazo)\b/.test(s)) return 'blocked';
  if (/\b(subir|cargar|factura|adjunt|nueva)\b/.test(s)) return 'upload';
  return 'help';
}

export function Home() {
  const me = useMe();
  const invoices = useInvoices();
  const mandate = useMandate();
  const approvals = useApprovals();
  const uploadQueue = useUploadQueue();

  const [promptText, setPromptText] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [oliState, setOliState] = useState<OliState>('idle');
  const [busy, setBusy] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const [hintIndex, setHintIndex] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const dragCounter = useRef(0);

  // Rotating hints placeholder
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.hidden || promptText || document.activeElement === textareaRef.current || messages.length > 0) {
        return;
      }
      setHintIndex((prev) => (prev + 1) % HINTS.length);
    }, 4500);
    return () => clearInterval(timer);
  }, [promptText, messages.length]);

  // Scroll to latest message
  useEffect(() => {
    if (messages.length > 0 && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  if (invoices.isError) {
    return <ErrorState error={invoices.error} onRetry={() => void invoices.refetch()} />;
  }

  const list = invoices.data ?? [];
  const stats = computeStats(list);
  const briefing = buildBriefing(stats);
  const budget = mandate.data?.budget;
  const used =
    budget && budget.limitMinor > 0
      ? Math.min(100, Math.round((budget.reservedMinor / budget.limitMinor) * 100))
      : null;
  const firstName = me.data?.user.name?.split(' ')[0];

  const validateFiles = (filesList: File[]): string | null => {
    if (attachedFiles.length + filesList.length > 4) {
      return t('You can attach up to 4 files at a time.');
    }
    for (const f of filesList) {
      if (!UPLOAD.mimeTypes.includes(f.type)) {
        return t('Only PDF, PNG or JPEG files are accepted.');
      }
      if (f.size === 0 || f.size > UPLOAD.maxBytes) {
        return t('Each file must be between 1 byte and 5 MB.');
      }
    }
    return null;
  };

  const handleFilesSelected = (filesList: FileList | null) => {
    if (!filesList || filesList.length === 0) return;
    const additions = Array.from(filesList);
    const err = validateFiles(additions);
    if (err) {
      setInputError(err);
      return;
    }
    setInputError(null);
    setAttachedFiles((prev) => [...prev, ...additions]);
    setOliState('listening');
  };

  const removeFile = (index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
    if (attachedFiles.length <= 1 && !promptText) {
      setOliState('idle');
    }
  };

  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current <= 0) {
      setIsDragging(false);
      dragCounter.current = 0;
    }
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    dragCounter.current = 0;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesSelected(e.dataTransfer.files);
    }
  };

  const ask = async (userQuery: string, filesToSubmit: File[] = attachedFiles) => {
    const trimmed = userQuery.trim();
    if (!trimmed && filesToSubmit.length === 0) return;

    setInputError(null);
    setBusy(true);
    setPromptText('');
    setAttachedFiles([]);

    const userTurnId = 'user-' + Date.now();
    const userFiles = filesToSubmit.map((f) => ({ name: f.name, size: f.size }));
    setMessages((prev) => [
      ...prev,
      { id: userTurnId, kind: 'user', text: trimmed || undefined, files: userFiles },
    ]);

    setOliState('thinking');

    // Add pending assistant bubble
    const pendingTurnId = 'pending-' + Date.now();
    setMessages((prev) => [
      ...prev,
      { id: pendingTurnId, kind: 'assistant', text: t('Reviewing...'), isPending: true },
    ]);

    // Handle real file uploads if attached
    if (filesToSubmit.length > 0) {
      uploadQueue.add(filesToSubmit);
    }

    await new Promise((r) => setTimeout(r, 600));

    const replyTurnId = 'assistant-' + Date.now();
    const content = renderAssistantReply(trimmed, filesToSubmit);

    setMessages((prev) =>
      prev.filter((m) => m.id !== pendingTurnId).concat({
        id: replyTurnId,
        kind: 'assistant',
        contentNode: content,
      }),
    );

    setBusy(false);
    setOliState(filesToSubmit.length > 0 ? 'happy' : 'understanding');
  };

  const renderAssistantReply = (text: string, files: File[]): ReactNode => {
    // 1. If files were attached, confirm real upload
    if (files.length > 0) {
      return (
        <div className="space-y-3">
          <p className="text-sm text-ink">
            {files.length === 1
              ? t('I received your invoice and started automated analysis.')
              : t('I received {n} invoices and started automated analysis.', { n: files.length })}
          </p>
          <div className="space-y-1.5">
            {files.map((file, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between rounded-lg border border-hairline bg-bone/70 px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2 truncate">
                  <FileText className="size-4 shrink-0 text-slate-500" aria-hidden />
                  <span className="truncate text-ink">{file.name}</span>
                </div>
                <span className="shrink-0 text-slate-400">{Math.ceil(file.size / 1024)} KB</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500">
            {t('The engine is extracting data, matching agreements, and checking policy limits.')}
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Link to="/app/bills" className={buttonClass('secondary', 'sm')}>
              {t('View bills progress')} <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </div>
        </div>
      );
    }

    const intent = intentFor(text);

    // 2. Intent: Review / Approvals
    if (intent === 'review') {
      const pendingList = approvals.data?.filter((a) => a.state === 'PENDING') ?? [];
      const needsReviewCount = stats.needsYouCount;

      if (needsReviewCount > 0) {
        return (
          <div className="space-y-3">
            <p className="text-sm text-ink">
              {t('You have {n} invoices that need your review and decision.', { n: needsReviewCount })}
            </p>
            {pendingList.length > 0 && (
              <ul className="divide-y divide-hairline rounded-lg border border-hairline bg-bone/50 text-xs">
                {pendingList.slice(0, 3).map((a) => (
                  <li key={a.id} className="flex items-center justify-between p-2.5">
                    <div className="min-w-0">
                      <p className="truncate font-normal text-ink">{a.reason || t('Approval required')}</p>
                      <p className="text-slate-500">{new Date(a.createdAt).toLocaleDateString()}</p>
                    </div>
                    <span className="rounded bg-white px-2 py-0.5 text-xs ring-1 ring-inset ring-ink">
                      {t('Pending')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              <Link to="/app/approvals" className={buttonClass('primary', 'sm')}>
                {t('Go to Approvals ({n})', { n: needsReviewCount })} <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </div>
          </div>
        );
      }

      return (
        <div className="space-y-2">
          <p className="text-sm text-ink">
            {t('Everything is up to date! There are no invoices waiting for your review right now.')}
          </p>
          <p className="text-xs text-slate-500">
            {t('Oli will notify you if an invoice exceeds automatic limits or has agreement mismatches.')}
          </p>
        </div>
      );
    }

    // 3. Intent: Budget
    if (intent === 'budget') {
      if (budget) {
        const remaining = Math.max(0, budget.limitMinor - budget.reservedMinor);
        const percent = budget.limitMinor > 0 ? Math.round((budget.reservedMinor / budget.limitMinor) * 100) : 0;
        return (
          <div className="space-y-3">
            <p className="text-sm text-ink">
              {t('Here is your budget status for period {period}:', { period: budget.periodKey })}
            </p>
            <div className="rounded-lg border border-hairline bg-bone/60 p-3.5">
              <div className="flex items-baseline justify-between text-xs">
                <span className="text-slate-600">{t('Reserved / Limit')}</span>
                <span className="tabular-nums text-ink">{percent}% {t('reserved')}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-sm bg-smoke">
                <div
                  className={percent >= 70 ? 'h-full bg-ink' : 'h-full bg-highlighter'}
                  style={{ width: `${Math.min(100, percent)}%` }}
                />
              </div>
              <div className="mt-2 flex items-baseline justify-between text-xs">
                <span className="text-slate-500">{t('Available to spend:')}</span>
                <span className="text-sm font-normal tabular-nums text-ink">{formatMoney(remaining, budget.currency)}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <Link to="/app/rules" className={buttonClass('secondary', 'sm')}>
                {t('View rules and limits')} <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </div>
          </div>
        );
      }
      return (
        <p className="text-sm text-ink">
          {t('No active budget policy is configured yet. You can set limits under Rules.')}
        </p>
      );
    }

    // 4. Intent: Due
    if (intent === 'due') {
      const upcoming = stats.upcoming;
      const overdue = stats.overdue;
      const totalDue = upcoming.length + overdue.length;

      if (totalDue > 0) {
        return (
          <div className="space-y-3">
            <p className="text-sm text-ink">
              {overdue.length > 0
                ? t('{o} overdue and {u} invoices due in the next 14 days.', { o: overdue.length, u: upcoming.length })
                : t('{u} invoices due in the next 14 days.', { u: upcoming.length })}
            </p>
            <ul className="divide-y divide-hairline rounded-lg border border-hairline bg-bone/50 text-xs">
              {[...overdue, ...upcoming].slice(0, 3).map((inv) => (
                <li key={inv.id} className="flex items-center justify-between p-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-ink">{invoiceTitle(inv)}</p>
                    <p className={isOverdue(inv.dueDate) ? 'text-ink font-normal' : 'text-slate-500'}>
                      {dueLabel(inv.dueDate)}
                    </p>
                  </div>
                  <span className="tabular-nums text-ink">{formatMoney(inv.amountMinor, inv.currency)}</span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2 pt-1">
              <Link to="/app/bills" className={buttonClass('secondary', 'sm')}>
                {t('View all bills')} <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </div>
          </div>
        );
      }

      return (
        <p className="text-sm text-ink">
          {t('Nothing due in the next two weeks. All payments are clear!')}
        </p>
      );
    }

    // 5. Intent: Blocked
    if (intent === 'blocked') {
      const blockedCount = stats.blockedCount;
      if (blockedCount > 0) {
        return (
          <div className="space-y-3">
            <p className="text-sm text-ink">
              {t('Oli has blocked {n} invoices due to policy rules.', { n: blockedCount })}
            </p>
            <p className="text-xs text-slate-500">
              {t('Invoices are blocked when vendors are unauthorized, duplicate invoice numbers appear, or amounts exceed the hard ceiling.')}
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Link to="/app/bills?outcome=BLOCKED" className={buttonClass('secondary', 'sm')}>
                {t('View blocked invoices')} <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </div>
          </div>
        );
      }
      return (
        <p className="text-sm text-ink">
          {t('Great news: you have zero blocked invoices in your organization.')}
        </p>
      );
    }

    // 6. Intent: Upload
    if (intent === 'upload') {
      return (
        <div className="space-y-3">
          <p className="text-sm text-ink">
            {t('You can upload invoices right here by attaching files or dropping them into the composer.')}
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              className={buttonClass('primary', 'sm')}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="size-3.5" aria-hidden /> {t('Choose invoice file')}
            </button>
            <Link to="/app/bills" className={buttonClass('secondary', 'sm')}>
              {t('Open full bills uploader')} <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </div>
        </div>
      );
    }

    // 7. General help
    return (
      <div className="space-y-3">
        <p className="text-sm text-ink">
          {t('I am Oli, your AP copilot. I review invoices against your policies, monitor budget reservations, and ask you whenever an exception requires human authorization.')}
        </p>
        <div className="flex flex-wrap gap-1.5 pt-1">
          <button
            type="button"
            className="rounded-md border border-hairline bg-white px-2.5 py-1 text-xs text-slate-700 hover:border-ink hover:text-ink"
            onClick={() => void ask(t('¿Qué facturas necesitan mi revisión?'))}
          >
            {t('Needs approval')}
          </button>
          <button
            type="button"
            className="rounded-md border border-hairline bg-white px-2.5 py-1 text-xs text-slate-700 hover:border-ink hover:text-ink"
            onClick={() => void ask(t('¿Cómo va el presupuesto de este mes?'))}
          >
            {t('Budget status')}
          </button>
          <button
            type="button"
            className="rounded-md border border-hairline bg-white px-2.5 py-1 text-xs text-slate-700 hover:border-ink hover:text-ink"
            onClick={() => void ask(t('¿Qué facturas vencen en los próximos 14 días?'))}
          >
            {t('Coming due')}
          </button>
        </div>
      </div>
    );
  };

  const handleFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    void ask(promptText);
  };

  return (
    <div className="space-y-8">
      {/* ───────────────── 1. OLI COPILOT HERO & TEXTFIELD ───────────────── */}
      <section
        aria-label={t('Oli Copilot')}
        onDragEnter={handleDragEnter}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          'relative overflow-hidden rounded-2xl border bg-white p-6 transition-all sm:p-8',
          isDragging ? 'border-ink ring-2 ring-highlighter' : 'border-hairline shadow-sm',
        )}
      >
        <div className="flex flex-col items-center text-center">
          {/* Oli Animated Canvas Presence */}
          <div className="relative mb-2 flex size-[120px] items-center justify-center sm:size-[140px]">
            <Oli
              state={oliState}
              dark={false}
              speed={0.75}
              particles={1800}
              size={140}
              label={t('Oli Assistant')}
            />
          </div>

          {/* Heading */}
          <h1 className="text-2xl font-normal tracking-tight text-ink sm:text-3xl">
            {firstName ? t('Hi {name}, what are we resolving today?', { name: firstName }) : t('What are we resolving today?')}
          </h1>
          <p className="mt-1.5 max-w-lg text-sm text-slate-500">
            {t('I review invoices against your mandate, monitor budgets, and flag what needs your approval.')}
          </p>

          {/* Chat Turn History (if active) */}
          {messages.length > 0 && (
            <div className="mt-6 w-full max-w-2xl space-y-3.5 text-left">
              <div className="flex items-center justify-between border-b border-hairline pb-2">
                <span className="text-xs font-normal text-slate-400">
                  <Sparkles className="mr-1 inline size-3 text-highlighter" /> {t('Conversation with Oli')}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setMessages([]);
                    setOliState('idle');
                  }}
                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-ink"
                >
                  <RotateCcw className="size-3" /> {t('Clear')}
                </button>
              </div>

              <div className="max-h-[320px] space-y-3 overflow-y-auto pr-1">
                {messages.map((turn) => (
                  <div
                    key={turn.id}
                    className={cn(
                      'flex flex-col gap-1',
                      turn.kind === 'user' ? 'items-end' : 'items-start',
                    )}
                  >
                    <div
                      className={cn(
                        'max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed sm:max-w-[80%]',
                        turn.kind === 'user'
                          ? 'bg-ink text-white'
                          : 'border border-hairline bg-bone text-ink',
                      )}
                    >
                      {turn.text && <p className="whitespace-pre-wrap">{turn.text}</p>}

                      {turn.files && turn.files.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {turn.files.map((f, i) => (
                            <div
                              key={i}
                              className="flex items-center gap-2 rounded bg-white/10 px-2 py-1 text-xs"
                            >
                              <FileText className="size-3.5" />
                              <span className="truncate">{f.name}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {turn.contentNode}
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            </div>
          )}

          {/* Interactive Composer / Textfield */}
          <form
            onSubmit={handleFormSubmit}
            className="mt-6 w-full max-w-2xl text-left"
          >
            <div className="rounded-xl border border-slate-300 bg-white p-3 transition-colors focus-within:border-ink focus-within:ring-1 focus-within:ring-ink">
              {/* Attached file chips */}
              {attachedFiles.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {attachedFiles.map((f, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1.5 rounded-md bg-bone px-2 py-1 text-xs text-slate-700 ring-1 ring-inset ring-hairline"
                    >
                      <FileText className="size-3.5 text-slate-500" />
                      <span className="max-w-[140px] truncate">{f.name}</span>
                      <button
                        type="button"
                        onClick={() => removeFile(i)}
                        className="rounded p-0.5 text-slate-400 hover:text-ink"
                        aria-label={t('Remove file')}
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Textarea */}
              <textarea
                ref={textareaRef}
                value={promptText}
                onChange={(e) => {
                  setPromptText(e.target.value);
                  setOliState(e.target.value.length > 0 ? 'listening' : 'idle');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void ask(promptText);
                  }
                }}
                placeholder={HINTS[hintIndex]}
                rows={2}
                className="w-full resize-none border-0 bg-transparent p-1 text-sm leading-relaxed text-ink placeholder:text-slate-400 focus:outline-none"
              />

              {/* Action bar inside textfield */}
              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-600 transition-colors hover:bg-bone hover:text-ink"
                    title={t('Attach invoice (PDF, PNG, JPG)')}
                  >
                    <Paperclip className="size-4" />
                    <span className="hidden sm:inline">{t('Attach invoice')}</span>
                  </button>
                  <span className="hidden text-xs text-slate-400 sm:inline">
                    · {t('or drag & drop files')}
                  </span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept={UPLOAD.accept}
                    className="sr-only"
                    onChange={(e) => {
                      handleFilesSelected(e.target.files);
                      e.target.value = '';
                    }}
                  />
                </div>

                <button
                  type="submit"
                  disabled={busy || (!promptText.trim() && attachedFiles.length === 0)}
                  className={cn(
                    'grid size-8 place-items-center rounded-lg transition-colors',
                    promptText.trim() || attachedFiles.length > 0
                      ? 'bg-highlighter text-ink hover:opacity-90'
                      : 'bg-smoke text-slate-400 cursor-not-allowed',
                  )}
                  aria-label={t('Send message to Oli')}
                >
                  <ArrowUp className="size-4" />
                </button>
              </div>
            </div>

            {inputError && (
              <p className="mt-2 text-xs text-rose-600">{inputError}</p>
            )}

            {/* Suggestions Chips */}
            <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
              {SUGGESTIONS.map((s, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => void ask(s.query)}
                  className="rounded-full border border-hairline bg-bone px-3 py-1 text-xs text-slate-600 transition-colors hover:border-ink hover:text-ink"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </form>
        </div>
      </section>

      {/* ───────────────── 2. LIVE DASHBOARD (APP ACTUAL) ───────────────── */}
      <section aria-label={t('Overview')} className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-normal text-ink">{t('Organization Overview')}</h2>
            <p className="text-sm text-slate-500">
              {t('Live activity evaluated against your finance mandate.')}
            </p>
          </div>
          <Beam>
            <Link to="/app/bills" className={buttonClass('primary', 'md')}>
              <Upload className="size-4" aria-hidden /> {t('Upload invoices')}
            </Link>
          </Beam>
        </div>

        {/* 4 Summary Stat Cards */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            loading={invoices.isLoading}
            label={t('Approved invoices')}
            value={stats.approvedCount}
            icon={<CheckCircle2 className="size-5" />}
            tone="emerald"
            to="/app/bills?outcome=APPROVED"
          />
          <Stat
            loading={invoices.isLoading}
            label={t('Blocked')}
            value={stats.blockedCount}
            icon={<Ban className="size-5" />}
            tone="rose"
            to="/app/bills?outcome=BLOCKED"
          />
          <Stat
            loading={invoices.isLoading}
            label={t('Needs you')}
            value={stats.needsYouCount}
            icon={<Hand className="size-5" />}
            tone="amber"
            to="/app/approvals"
          />
          <Stat
            loading={invoices.isLoading}
            label={t('Due in 14 days')}
            value={stats.upcoming.length}
            icon={<CalendarClock className="size-5" />}
            tone="indigo"
            to="/app/bills"
          />
        </div>

        {/* 2 Column + 1 Column Layout */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Primary Column (2 cols) */}
          <div className="space-y-6 lg:col-span-2">
            <InboxPreview />

            <Card>
              <CardHeader
                title={t('Recent activity')}
                action={
                  <Link to="/app/bills" className="text-sm text-ink underline underline-offset-2">
                    {t('View all')}
                  </Link>
                }
              />
              {invoices.isLoading ? (
                <div className="space-y-3 p-5">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-10" />
                  ))}
                </div>
              ) : list.length === 0 ? (
                <EmptyState
                  title={t('No invoices yet')}
                  body={t('Upload your first invoice and Oli will review it against your rules.')}
                  action={
                    <Link to="/app/bills" className={buttonClass('primary')}>
                      {t('Upload invoices')}
                    </Link>
                  }
                />
              ) : (
                <InvoiceList invoices={list.slice(0, 6)} compact />
              )}
            </Card>
          </div>

          {/* Secondary Column (1 col) */}
          <div className="space-y-6">
            {/* Briefing Card */}
            <Card className="border-obsidian bg-obsidian text-white">
              <div className="p-5">
                <h3 className="caption !text-slate-400">
                  {t('{name}’s briefing', { name: brand.name })}
                </h3>
                {invoices.isLoading ? (
                  <Skeleton className="mt-3 h-16 opacity-30" />
                ) : (
                  <ul className="mt-3 space-y-2 text-sm leading-relaxed text-white">
                    {briefing.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>

            {/* Budget Progress Card */}
            {budget && used != null && (
              <Card className="p-5">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-sm text-ink">
                    {t('Budget · {period}', { period: budget.periodKey })}
                  </h3>
                  <span className="text-xs text-slate-500">{t('{n}% reserved', { n: used })}</span>
                </div>
                <div
                  className="mt-3 h-2 overflow-hidden rounded-sm bg-bone ring-1 ring-inset ring-hairline"
                  role="progressbar"
                  aria-valuenow={used}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={t('Budget reserved')}
                >
                  <div
                    className={used >= 70 ? 'h-full bg-ink' : 'h-full bg-highlighter'}
                    style={{ width: `${used}%` }}
                  />
                </div>
                <p className="mt-2 text-sm text-slate-600">
                  {t('{left} left of {total}', {
                    left: formatMoney(Math.max(0, budget.limitMinor - budget.reservedMinor), budget.currency),
                    total: formatMoney(budget.limitMinor, budget.currency),
                  })}
                </p>
              </Card>
            )}

            {/* Coming Due Card */}
            <Card>
              <CardHeader title={t('Coming due')} />
              {stats.upcoming.length === 0 && stats.overdue.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-500">
                  {t('Nothing due in the next two weeks.')}
                </p>
              ) : (
                <ul className="divide-y divide-hairline">
                  {[...stats.overdue, ...stats.upcoming].slice(0, 5).map((inv) => (
                    <li key={inv.id}>
                      <Link
                        to={`/app/bills/${inv.id}`}
                        className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-bone"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm text-ink">{invoiceTitle(inv)}</p>
                          <p
                            className={`text-xs ${
                              isOverdue(inv.dueDate)
                                ? 'text-ink underline decoration-dotted underline-offset-2'
                                : 'text-slate-500'
                            }`}
                          >
                            {dueLabel(inv.dueDate)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm tabular-nums text-ink">
                            {formatMoney(inv.amountMinor, inv.currency)}
                          </p>
                          <OutcomeBadge outcome={getOutcome(inv)} className="mt-1" />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      </section>
    </div>
  );
}

const TONES = {
  emerald: 'bg-highlighter text-ink',
  rose: 'bg-ink text-white',
  amber: 'bg-white text-ink ring-1 ring-inset ring-ink',
  indigo: 'bg-bone text-ink',
} as const;

function Stat({
  label,
  value,
  icon,
  tone,
  to,
  loading,
}: {
  label: string;
  value: number;
  icon: ReactNode;
  tone: keyof typeof TONES;
  to: string;
  loading?: boolean;
}) {
  return (
    <Link
      to={to}
      className="rounded-2xl border border-hairline bg-white p-5 transition-colors hover:border-ink"
    >
      <div className={`grid size-9 place-items-center rounded-lg ${TONES[tone]}`} aria-hidden>
        {icon}
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-8 w-12" />
      ) : (
        <p className="mt-3 text-[28px] leading-none tabular-nums text-ink">{value}</p>
      )}
      <p className="mt-1 text-sm text-slate-500">{label}</p>
    </Link>
  );
}
