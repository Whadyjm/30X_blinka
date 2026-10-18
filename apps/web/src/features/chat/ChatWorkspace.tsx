import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router';
import { ArrowDown, ArrowUp, FileText, History, LayoutDashboard, MessageSquare, Paperclip, Plus, Send, X } from 'lucide-react';
import type { ChatChannel } from '@oli/contracts';
import { buttonClass } from '@/components/ui/Button';
import { UPLOAD } from '@/config/env';
import { useMe } from '@/hooks/queries';
import { t } from '@/i18n';
import { cn } from '@/lib/cn';
import { ChatReply } from './ChatReply';
import { ChatMascot } from './ChatMascot';
import { useConversation } from './useConversation';
import { chatFailureMessage } from './failure-message';
import { useTelegramHistoryPreference } from './useTelegramHistoryPreference';

const suggestions = ['¿Qué facturas necesitan mi revisión?', '¿Cómo va el presupuesto de este mes?'];
export function ChatWorkspace() {
  const me = useMe();
  const location = useLocation();
  const reviewInvoiceId = typeof location.state?.reviewInvoiceId === 'string' ? location.state.reviewInvoiceId : null;
  const scope = me.data?.org ? `${me.data.org.id}:${me.data.user.id}` : '';
  const telegramPreference = useTelegramHistoryPreference(scope);
  const web = useConversation(scope, 'WEB'), telegram = useConversation(telegramPreference.visible ? scope : '', 'TELEGRAM');
  const [selectedChannel, setChannel] = useState<ChatChannel>('WEB');
  const channel = telegramPreference.visible ? selectedChannel : 'WEB';
  useEffect(() => { if (channel !== 'WEB' && web.revealTurnId) web.finishReveal(web.revealTurnId); }, [channel, web.revealTurnId, web.finishReveal]);
  const conversation = channel === 'WEB' ? web : telegram;
  const [draft, setDraft] = useState(() => reviewInvoiceId ? t('Help me resolve invoice {id}. Explain what is missing and prepare any changes for my confirmation.', { id: reviewInvoiceId }) : ''), [files, setFiles] = useState<File[]>([]);
  const drafts = useRef(new Map<string | null, { text: string; files: File[] }>());
  const tabToFocus = useRef<string | null | undefined>(undefined);
  const [closed, setClosed] = useState<{ scope: string; ids: string[] }>({ scope: '', ids: [] });
  const closedIds = closed.scope === scope ? closed.ids : [];
  const openThreads = web.conversations.filter(thread => !closedIds.includes(thread.id));
  const closedThreads = web.conversations.filter(thread => closedIds.includes(thread.id));
  const [inputError, setInputError] = useState<string | null>(null);
  const [nearBottom, setNearBottom] = useState(true), [dragging, setDragging] = useState(false);
  const root = useRef<HTMLElement>(null), log = useRef<HTMLDivElement>(null), textarea = useRef<HTMLTextAreaElement>(null), fileInput = useRef<HTMLInputElement>(null);
  const shouldFollow = useRef(true);
  const followReply = useCallback(() => {
    if (shouldFollow.current && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, []);
  const busy = web.sending || web.processing || web.loading;
  const empty = conversation.turns.length === 0 && !conversation.pending && !conversation.loading;
  const showCompanion = channel === 'WEB' && !empty;
  const thinking = conversation.sending || conversation.processing;
  const emptyRef = useRef(empty);
  emptyRef.current = empty;
  const webTabs = web.id === null ? [{ id: null, title: t('New conversation') }, ...openThreads] : openThreads;
  const webTabId = (id: string | null) => `web-thread-${id ?? 'new'}`;
  const selectWebConversation = (id: string | null) => {
    if ((id === null ? web.sending || web.loading : busy || !!web.pending) || (id !== null && id === web.id)) return;
    drafts.current.set(web.id, { text: draft, files });
    const saved = drafts.current.get(id);
    setDraft(saved?.text ?? ''); setFiles(saved?.files ?? []); setInputError(null);
    if (id === null) web.newConversation(); else web.selectConversation(id);
  };
  const rememberClosed = (ids: string[]) => {
    setClosed({ scope, ids });
    try { localStorage.setItem(`oli.chat.closed:${scope}`, JSON.stringify(ids)); } catch { /* Closing still works when storage is unavailable. */ }
  };
  const closeConversation = (id: string | null) => {
    if (busy || web.pending) return;
    const index = webTabs.findIndex(thread => thread.id === id);
    const remaining = webTabs.filter(thread => thread.id !== id);
    const next = remaining[Math.min(index, remaining.length - 1)]?.id ?? null;
    if (id === web.id) {
      if (id === null && next === null) { drafts.current.delete(null); setDraft(''); setFiles([]); }
      else selectWebConversation(next);
    }
    if (id !== null) rememberClosed([...closedIds, id]);
    tabToFocus.current = id === web.id ? next : web.id;
  };
  useEffect(() => {
    if (!scope) return;
    try {
      const saved = JSON.parse(localStorage.getItem(`oli.chat.closed:${scope}`) ?? '[]');
      setClosed({ scope, ids: Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string' && id.length <= 100) : [] });
    } catch { setClosed({ scope, ids: [] }); }
  }, [scope]);
  useEffect(() => {
    if (!busy && !web.pending && web.id && closedIds.includes(web.id)) selectWebConversation(openThreads[0]?.id ?? null);
  }, [busy, web.pending, web.id, closed, web.conversations]);
  useEffect(() => {
    if (channel === 'WEB') document.getElementById(webTabId(web.id))?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (channel === 'WEB' && !busy && tabToFocus.current !== undefined) {
      document.getElementById(webTabId(tabToFocus.current))?.focus(); tabToFocus.current = undefined;
    }
  }, [channel, web.id, web.conversations, busy, closed]);

  // visualViewport includes the space actually left above the mobile keyboard.
  useEffect(() => {
    const update = () => {
      if (!root.current) return;
      const viewport = window.visualViewport;
      const top = Math.max(0, root.current.getBoundingClientRect().top - (viewport?.offsetTop ?? 0));
      root.current.style.setProperty('--chat-height', `${Math.max(240, (viewport?.height ?? innerHeight) - top)}px`);
      if (shouldFollow.current && log.current) log.current.scrollTop = emptyRef.current ? 0 : log.current.scrollHeight;
    };
    update(); window.addEventListener('resize', update); window.visualViewport?.addEventListener('resize', update);
    return () => { window.removeEventListener('resize', update); window.visualViewport?.removeEventListener('resize', update); };
  }, []);
  useLayoutEffect(() => {
    shouldFollow.current = true;
    setNearBottom(true);
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [channel, conversation.id]);
  useLayoutEffect(() => {
    if (shouldFollow.current && log.current) { log.current.scrollTop = empty ? 0 : log.current.scrollHeight; setNearBottom(true); }
  }, [conversation.turns, conversation.pending, conversation.sending, conversation.loading]);
  useEffect(() => {
    if (textarea.current) { textarea.current.style.height = 'auto'; textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 144)}px`; }
  }, [draft, channel]);

  const attach = (incoming: File[]) => {
    if (channel !== 'WEB' || busy || web.pending) return;
    if (files.length + incoming.length > 4) { setInputError(t('You can attach up to 4 files at a time.')); return; }
    if (incoming.some(f => !UPLOAD.mimeTypes.includes(f.type))) { setInputError(t('Only PDF, PNG or JPEG files are accepted.')); return; }
    if (incoming.some(f => !f.size || f.size > UPLOAD.maxBytes)) { setInputError(t('Each file must be between 1 byte and 5 MB.')); return; }
    setInputError(null); setFiles(old => [...old, ...incoming]);
  };
  const send = async (text = draft) => {
    if (!web.canSend || channel !== 'WEB' || (!text.trim() && !files.length)) return;
    drafts.current.delete(web.id);
    shouldFollow.current = true; setInputError(null); setDraft(''); setFiles([]);
    await web.send(text.trim(), files);
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void send(); };

  return <section id="oli-chat" ref={root} className={cn('oli-chat relative -mx-4 -mt-6 flex min-h-0 flex-col overflow-hidden bg-paper md:mx-0 md:mt-0 md:rounded-2xl md:border md:border-hairline', dragging && 'ring-2 ring-inset ring-ink')}
    aria-label={t('Chat with Oli')} onDragOver={e => { if (channel === 'WEB') { e.preventDefault(); setDragging(true); } }}
    onDragLeave={e => { if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) setDragging(false); }}
    onDrop={e => { e.preventDefault(); setDragging(false); attach(Array.from(e.dataTransfer.files)); }}>
    <header className="shrink-0 border-b border-hairline px-4 pt-3 md:px-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 md:gap-3">
          {showCompanion && <ChatMascot compact state={thinking ? 'thinking' : draft.trim() ? 'listening' : undefined} />}
          <div className="min-w-0">
            <h1 className="text-lg leading-normal text-ink"><span className={showCompanion ? 'hidden sm:inline' : undefined}>{t('Chat with Oli')}</span>{showCompanion && <span className="sm:hidden">Oli</span>}</h1>
            {showCompanion && <p role="status" className="mt-1 text-xs leading-relaxed text-slate-600">{t(conversation.loading ? 'Loading conversation...' : thinking ? 'Oli is thinking...' : 'I’m here with you')}</p>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Link to="/app/dashboard" aria-label={t('Dashboard')} className="inline-flex min-h-11 min-w-11 items-center justify-center px-2 text-sm text-slate-600 hover:text-ink sm:px-3"><LayoutDashboard className="size-5 sm:hidden" aria-hidden /><span className="hidden sm:inline">{t('Dashboard')}</span></Link>
          {channel === 'WEB' && closedThreads.length > 0 && <details className="relative" onKeyDown={e => { if (e.key === 'Escape') { e.currentTarget.open = false; e.currentTarget.querySelector('summary')?.focus(); } }}
            onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.open = false; }}>
            <summary className="grid size-11 cursor-pointer list-none place-items-center rounded-md text-ink hover:bg-bone [&::-webkit-details-marker]:hidden" aria-label={t('Closed conversations')} title={t('Closed conversations')}><History className="size-5" aria-hidden /></summary>
            <div className="absolute right-0 top-full z-20 max-h-60 w-72 max-w-[85vw] overflow-y-auto rounded-md border border-hairline bg-paper p-2">
              <p className="px-3 py-2 text-sm text-slate-600">{t('Reopen a conversation')}</p>
              {closedThreads.map(thread => <button key={thread.id} type="button" disabled={busy || !!web.pending} className="block min-h-11 w-full truncate rounded-md px-3 text-left text-sm hover:bg-bone disabled:opacity-40"
                onClick={e => { rememberClosed(closedIds.filter(id => id !== thread.id)); selectWebConversation(thread.id); e.currentTarget.closest('details')!.open = false; tabToFocus.current = thread.id; }}>{thread.title || t('Invoice conversation')}</button>)}
            </div>
          </details>}
          {channel === 'WEB' && <button type="button" disabled={web.sending || web.loading} onClick={() => selectWebConversation(null)}
            className="grid size-11 place-items-center rounded-md text-ink hover:bg-bone disabled:opacity-40" aria-label={t('New conversation')} title={t('New conversation')}><Plus className="size-5" aria-hidden /></button>}
        </div>
      </div>
      {telegramPreference.visible && <div className="flex gap-5" role="tablist" aria-label={t('Conversation channels')}>
        {(['WEB', 'TELEGRAM'] as const).map(value => <button key={value} id={`chat-tab-${value}`} type="button" role="tab" aria-selected={channel === value} aria-controls="chat-panel" tabIndex={channel === value ? 0 : -1}
          onClick={() => setChannel(value)} onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
            e.preventDefault(); const next = e.key === 'Home' ? 'WEB' : e.key === 'End' ? 'TELEGRAM' : channel === 'WEB' ? 'TELEGRAM' : 'WEB';
            setChannel(next); document.getElementById(`chat-tab-${next}`)?.focus();
          } }} className={cn('flex min-h-11 items-center gap-2 border-b-2 px-1 text-sm', channel === value ? 'border-ink text-ink' : 'border-transparent text-slate-600 hover:text-ink')}>
          {value === 'WEB' ? <MessageSquare className="size-4" aria-hidden /> : <Send className="size-4" aria-hidden />}{value === 'WEB' ? 'Web' : 'Telegram'}
        </button>)}
      </div>}
    </header>
    <div id="chat-panel" role={telegramPreference.visible ? 'tabpanel' : undefined} aria-labelledby={telegramPreference.visible ? `chat-tab-${channel}` : undefined} className="flex min-h-0 flex-1 flex-col">
      {channel === 'WEB' && <div role="tablist" aria-label={t('Conversation history')} className="flex shrink-0 gap-1 overflow-x-auto border-b border-hairline px-4 pt-2 md:px-6">
        {webTabs.map((thread, index) => <div key={thread.id ?? 'new'} role="presentation" className={cn('flex min-h-11 shrink-0 items-center rounded-t-md border border-b-0',
          web.id === thread.id ? 'border-hairline bg-bone text-ink' : 'border-transparent text-slate-600 hover:bg-bone')}>
          <button id={webTabId(thread.id)} type="button" role="tab" aria-selected={web.id === thread.id}
          aria-controls="web-thread-panel" tabIndex={web.id === thread.id ? 0 : -1} disabled={busy || !!web.pending}
          title={thread.title || t('Invoice conversation')} onClick={() => selectWebConversation(thread.id)}
          onKeyDown={e => { if (e.key === 'Delete') { e.preventDefault(); closeConversation(thread.id); }
            else if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
            e.preventDefault(); const next = e.key === 'Home' ? 0 : e.key === 'End' ? webTabs.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + webTabs.length) % webTabs.length;
            const target = webTabs[next]!; selectWebConversation(target.id); document.getElementById(webTabId(target.id))?.focus();
          } }} className="min-h-11 max-w-44 truncate pl-3 pr-1 text-sm disabled:opacity-40">
          {thread.title || t('Invoice conversation')}
          </button>
          <button type="button" disabled={busy || !!web.pending} onClick={() => closeConversation(thread.id)} aria-label={t('Close conversation: {title}', { title: thread.title || t('New conversation') })}
            title={t('Close conversation')} className="grid size-11 shrink-0 place-items-center rounded-md hover:bg-paper disabled:opacity-40 md:size-8"><X className="size-3.5" aria-hidden /></button>
        </div>)}
      </div>}
      <div id={channel === 'WEB' ? 'web-thread-panel' : undefined} role={channel === 'WEB' ? 'tabpanel' : undefined}
        aria-labelledby={channel === 'WEB' ? webTabId(web.id) : undefined} className="flex min-h-0 flex-1 flex-col">
      <div ref={log} className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-y-contain px-4 py-5 md:px-6" role="log" aria-label={t(channel === 'WEB' ? 'Web conversation' : 'Telegram conversation')}
        aria-live="polite" aria-relevant="additions" onScroll={() => { const el = log.current!; const close = el.scrollHeight - el.clientHeight - el.scrollTop < 80; shouldFollow.current = close; setNearBottom(close); }}>
        {conversation.loading && <p role="status" className="text-sm text-slate-600">{t('Loading conversation...')}</p>}
        {empty && <div className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center py-4 text-center">
          {channel === 'WEB' ? <><ChatMascot />
            <h2 className="mt-4 text-xl text-ink">{t('What can we sort out today?')}</h2>
            <p className="mt-2 text-base leading-relaxed text-slate-600">{t('Ask me about an invoice, a supplier or your budget. We’ll take it one step at a time.')}</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">{suggestions.map(text => <button key={text} type="button" disabled={!web.canSend} onClick={() => void send(text)} className="min-h-11 rounded-md border border-hairline px-3 py-2 text-sm text-ink hover:bg-bone">{text}</button>)}</div>
          </> : <><Send className="size-8 text-ink" aria-hidden /><h2 className="mt-4 text-xl">{t('Your Telegram conversations appear here')}</h2>
            <p className="mt-2 text-base leading-relaxed text-slate-600">{t('Connect Telegram to keep its history here, separate from your web conversations.')}</p>
            <Link to="/app/integrations" className={buttonClass('secondary', 'md', 'mt-5')}>{t('Open integrations')}</Link></>}
        </div>}
        {conversation.turns.map(turn => <div key={turn.id} className="mx-auto max-w-3xl space-y-5">
          <div className="flex justify-end"><div className="max-w-[90%] rounded-2xl bg-bone px-4 py-3 text-base leading-7 text-ink md:max-w-[80%]">
            {turn.text && <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{turn.text}</p>}
            {turn.invoiceIds.length > 0 && <div className="flex flex-wrap gap-2">{turn.invoiceIds.map(id => <Link key={id} to={`/app/bills/${encodeURIComponent(id)}`} className="inline-flex min-h-11 items-center gap-2 text-sm underline underline-offset-4"><FileText className="size-4" aria-hidden />{t('View invoice')}</Link>)}</div>}
          </div></div>
          <div className="text-base leading-7 text-ink">{turn.reply ? <ChatReply reply={turn.reply} readOnly={channel === 'TELEGRAM'} animate={channel === 'WEB' && turn.id === web.revealTurnId} onRevealProgress={followReply} onRevealDone={web.finishReveal} /> : <p role="status" className="text-slate-600">{turn.state === 'FAILED' ? chatFailureMessage(turn.errorCode) : t('Oli is thinking...')}</p>}</div>
        </div>)}
        {conversation.pending && <div className="mx-auto max-w-3xl space-y-5">
          <div className="flex justify-end"><div className="max-w-[90%] rounded-2xl bg-bone px-4 py-3 text-base leading-7">
            <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{conversation.pending.text}</p>
            {conversation.pending.files.map(item => <p key={item.key} className="flex items-center gap-2 text-sm [overflow-wrap:anywhere]"><FileText className="size-4 shrink-0" aria-hidden />{item.file.name}</p>)}
          </div></div>
          {conversation.sending && <p role="status" className="text-base text-slate-600">{t('Oli is thinking...')}</p>}
        </div>}
      </div>
      </div>
      {!nearBottom && !empty && <button type="button" onClick={() => { shouldFollow.current = true; log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' }); }} aria-label={t('Go to latest message')}
        className="absolute bottom-40 right-5 grid size-11 place-items-center rounded-full border border-hairline bg-paper text-ink"><ArrowDown className="size-5" aria-hidden /></button>}
      <div className="chat-composer shrink-0 border-t border-hairline bg-paper px-3 pt-3 md:px-6">
        {conversation.error && <div role="alert" className="mb-2 space-y-2 text-sm text-ink"><p>{conversation.error}</p>{conversation.canRetry && <button className={buttonClass('secondary', 'sm')} disabled={conversation.sending} onClick={() => void conversation.retry()}>{t('Retry')}</button>}
          {conversation.pending && <button className={buttonClass('ghost', 'sm')} disabled={conversation.sending} onClick={conversation.dismiss}>{t('Dismiss failed message')}</button>}</div>}
        {channel === 'TELEGRAM' ? <div className="flex flex-wrap items-center justify-between gap-2 py-2">
          <p className="text-sm text-slate-600">{t('This conversation continues in Telegram.')}</p>
          <a href="https://t.me/Oliblinkabot" target="_blank" rel="noopener noreferrer" className={buttonClass('secondary', 'md')}>{t('Continue in Telegram')}<Send className="size-4" aria-hidden /></a>
        </div> : <form onSubmit={submit}>
          {files.length > 0 && <div className="mb-2 flex flex-wrap gap-2">{files.map((file, index) => <span key={index} className="inline-flex min-w-0 items-center gap-1 rounded-md bg-bone pl-3 text-sm"><FileText className="size-4 shrink-0" aria-hidden /><span className="max-w-40 truncate">{file.name}</span><button type="button" className="grid size-11 place-items-center" aria-label={t('Remove file')} onClick={() => setFiles(old => old.filter((_, i) => i !== index))}><X className="size-4" aria-hidden /></button></span>)}</div>}
          <div className="flex items-end gap-1 rounded-3xl border border-slate-300 bg-paper p-1 focus-within:border-ink">
            <button type="button" disabled={busy || !!web.pending} onClick={() => fileInput.current?.click()} className="grid size-11 shrink-0 place-items-center rounded-full text-ink hover:bg-bone disabled:opacity-40" aria-label={t('Attach invoice (PDF, PNG, JPG)')}><Paperclip className="size-5" aria-hidden /></button>
            <input ref={fileInput} type="file" multiple accept={UPLOAD.accept} className="sr-only" aria-label={t('Attach invoice')} onChange={e => { attach(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
            <textarea ref={textarea} rows={1} maxLength={4000} value={draft} aria-label={t('Message to Oli')} placeholder={t('Ask Oli...')}
              onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && matchMedia('(pointer: fine)').matches) { e.preventDefault(); void send(); } }}
              className="block max-h-36 min-h-11 min-w-0 flex-1 resize-none border-0 bg-transparent px-1 py-2.5 text-base leading-6 text-ink placeholder:text-slate-600 focus:outline-none" />
            <button type="submit" disabled={!web.canSend || (!draft.trim() && !files.length)} aria-label={t('Send message to Oli')} className="grid size-11 shrink-0 place-items-center rounded-full bg-ink text-on-ink disabled:bg-bone disabled:text-slate-500"><ArrowUp className="size-5" aria-hidden /></button>
          </div>
          {web.pending && !web.sending && !web.error && <button type="button" className={buttonClass('secondary', 'sm', 'mt-2')} onClick={() => void web.retry()}>{t('Resume pending message')}</button>}
          {inputError && <p role="alert" className="mt-2 text-sm text-ink">{inputError}</p>}
        </form>}
      </div>
    </div>
  </section>;
}
