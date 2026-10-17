import { useEffect, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  ArrowUp,
  Ban,
  CalendarClock,
  CheckCircle2,
  CheckSquare,
  FileText,
  Hand,
  Paperclip,
  RotateCcw,
  Sparkles,
  Upload,
  Wallet,
  X,
} from 'lucide-react';
import { Oli, type OliState } from '@/components/Oli';
import { OutcomeBadge } from '@/components/Badges';
import { buttonClass } from '@/components/ui/Button';
import { Beam } from '@/components/ui/Beam';
import { Card, CardHeader, EmptyState, ErrorState, Skeleton } from '@/components/ui/Card';
import { brand } from '@/config/brand';
import { UPLOAD } from '@/config/env';
import { useInvoices, useMandate, useMe } from '@/hooks/queries';
import { t } from '@/i18n';
import { buildBriefing, computeStats } from '@/lib/briefing';
import { dueLabel, isOverdue } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { getOutcome } from '@/lib/outcome';
import { InvoiceList, invoiceTitle } from '@/features/invoices/InvoiceList';
import { InboxPreview } from '@/features/integrations/InboxPreview';
import { useConversation } from '@/features/chat/useConversation';
import { ChatReply } from '@/features/chat/ChatReply';
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
  { label: 'Facturas por revisar', icon: CheckSquare, query: '¿Qué facturas necesitan mi revisión?' },
  { label: 'Estado del presupuesto', icon: Wallet, query: '¿Cómo va el presupuesto de este mes?' },
  { label: 'Próximos vencimientos', icon: CalendarClock, query: '¿Qué facturas vencen en los próximos 14 días?' },
  { label: 'Facturas bloqueadas', icon: Ban, query: '¿Hay facturas bloqueadas o rechazadas?' },
];

export function Home() {
  const me = useMe();
  const invoices = useInvoices();
  const mandate = useMandate();
  const conversation = useConversation(me.data?.org ? `${me.data.org.id}:${me.data.user.id}` : '');

  const [promptText, setPromptText] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [oliState, setOliState] = useState<OliState>('idle');
  const busy = conversation.sending || conversation.processing || conversation.loading;
  const messages: ChatTurn[] = conversation.turns.flatMap(turn => [
    { id: `${turn.id}-user`, kind: 'user', text: turn.text || undefined,
      contentNode: turn.invoiceIds.length > 0 ? <div className="mt-2 flex flex-wrap gap-2">{turn.invoiceIds.map(id =>
        <Link key={id} to={`/app/bills/${encodeURIComponent(id)}`} className="underline">{t('View invoice')}</Link>)}</div> : undefined },
    { id: turn.id, kind: 'assistant', contentNode: turn.reply ? <ChatReply reply={turn.reply} /> : undefined,
      text: turn.reply ? undefined : t(turn.state === 'FAILED' ? 'This message failed. Please try again.' : 'Reviewing...') },
  ]);
  if (conversation.pending) {
    const pending = conversation.pending;
    messages.push({ id: pending.key, kind: 'user', text: pending.text || undefined,
      files: pending.files.map(item => ({ name: item.file.name, size: item.file.size })),
      contentNode: <div className="mt-2 space-y-1">{pending.files.filter(item => item.invoiceId).map(item =>
        <p key={item.key}><Link to={`/app/bills/${encodeURIComponent(item.invoiceId!)}`} className="underline">{t('Invoice received')}: {item.file.name}</Link></p>)}</div> });
    if (conversation.sending) messages.push({ id: `${pending.key}-pending`, kind: 'assistant', text: t('Uploading files and consulting Oli...'), isPending: true });
  }
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
  }, [messages.length, conversation.sending]);

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
  const userName = me.data?.user.name?.trim();

  const validateFiles = (filesList: File[], existing = 0): string | null => {
    if (existing + filesList.length > 4) {
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
    const err = validateFiles(additions, attachedFiles.length);
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
    if (!conversation.canSend || (!trimmed && filesToSubmit.length === 0)) return;
    const problem = validateFiles(filesToSubmit);
    if (problem || trimmed.length > 4000) {
      setInputError(problem ?? t('Messages can contain up to 4000 characters.'));
      return;
    }
    setInputError(null);
    setPromptText('');
    setAttachedFiles([]);
    setOliState('thinking');
    await conversation.send(trimmed, filesToSubmit);
    setOliState('idle');
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
            {userName ? t('Hi {name}, what are we resolving today?', { name: userName }) : t('What are we resolving today?')}
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
                  disabled={busy || !!conversation.pending}
                  onClick={() => {
                    conversation.newConversation();
                    setOliState('idle');
                  }}
                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-ink"
                >
                  <RotateCcw className="size-3" /> {t('New conversation')}
                </button>
              </div>

              <div className="max-h-[480px] space-y-3 overflow-y-auto pr-1" role="log" aria-label={t('Conversation with Oli')}>
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
                      {turn.text && <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{turn.text}</p>}

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
                maxLength={4000}
                aria-label={t('Message to Oli')}
                className="w-full resize-none border-0 bg-transparent p-1 text-base sm:text-sm leading-relaxed text-ink placeholder:text-slate-400 focus:outline-none"
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
                  disabled={!conversation.canSend || (!promptText.trim() && attachedFiles.length === 0)}
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

            {conversation.error && (
              <div role="alert" className="mt-3 space-y-2 text-sm">
                <p>{conversation.error}</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={buttonClass('secondary', 'sm')} disabled={busy} onClick={() => void conversation.retry()}>{t('Retry')}</button>
                  {conversation.pending && <button type="button" className={buttonClass('ghost', 'sm')} disabled={busy} onClick={conversation.dismiss}>{t('Dismiss failed message')}</button>}
                </div>
              </div>
            )}
            {conversation.pending && !conversation.sending && !conversation.error && (
              <button type="button" className={buttonClass('secondary', 'sm', 'mt-3')} disabled={busy} onClick={() => void conversation.retry()}>{t('Resume pending message')}</button>
            )}
            {conversation.loading && <p role="status" className="mt-2 text-sm">{t('Loading conversation...')}</p>}
            {inputError && (
              <p className="mt-2 text-xs text-rose-600">{inputError}</p>
            )}

            {/* Suggestions Chips */}
            <div className="mt-3.5 flex flex-wrap items-center justify-center gap-2">
              {SUGGESTIONS.map((s, idx) => {
                const Icon = s.icon;
                return (
                  <button
                    key={idx}
                    type="button"
                    disabled={!conversation.canSend}
                    onClick={() => void ask(s.query)}
                    className="inline-flex items-center gap-2 rounded-full border border-hairline bg-bone px-3.5 py-1.5 text-xs text-slate-700 transition-all hover:border-ink hover:bg-white hover:text-ink hover:shadow-xs active:scale-[0.98]"
                  >
                    <Icon className="size-3.5 text-ink shrink-0" aria-hidden />
                    <span>{s.label}</span>
                  </button>
                );
              })}
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
