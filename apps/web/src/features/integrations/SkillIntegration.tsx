import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Bot, Check, Copy, Download, X } from 'lucide-react';
import type { SkillConnection } from '@oli/contracts';
import { api, errorMessage } from '@/api';
import { Button, buttonClass } from '@/components/ui/Button';
import { Card, ErrorState, InlineAlert, Skeleton } from '@/components/ui/Card';
import { useMe } from '@/hooks/queries';
import { t } from '@/i18n';
import { formatDateTime } from '@/lib/dates';
import { env } from '@/config/env';
import { skillSetup } from './skill-setup';

const inputClass = 'w-full min-w-0 rounded-md border border-hairline bg-bone px-3 py-2.5 text-sm text-ink';

function ConnectionRow({ connection, refresh }: { connection: SkillConnection; refresh: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [editing, setEditing] = useState(false);
  const [expiry, setExpiry] = useState('');
  const [error, setError] = useState<string | null>(null);
  const revoked = connection.revokedAt !== null;
  const expired = connection.expiresAt !== null && new Date(connection.expiresAt).getTime() <= Date.now();
  const revoke = useMutation({ mutationFn: () => api.revokeSkillConnection(connection.id),
    onSuccess: () => { setConfirm(false); refresh(); }, onError: e => setError(errorMessage(e)) });
  const update = useMutation({ mutationFn: () => api.updateSkillConnection(connection.id, expiry ? new Date(expiry).toISOString() : null),
    onSuccess: () => { setEditing(false); refresh(); }, onError: e => setError(errorMessage(e)) });
  const edit = () => {
    const date = connection.expiresAt ? new Date(connection.expiresAt) : null;
    setExpiry(date ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
    setError(null); setConfirm(false); setEditing(true);
  };
  return <li className="border-t border-hairline py-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="break-words text-sm font-medium text-ink">{connection.name}</p>
        <p className="mt-1 text-xs text-slate-600"><code>{connection.keyPrefix}…</code> · {t(revoked ? 'Revoked' : expired ? 'Expired' : 'Active')}</p>
        <p className="mt-2 text-xs text-slate-600">{connection.expiresAt ? t('Expires on {date}', { date: formatDateTime(connection.expiresAt) }) : t('No expiration')}</p>
        <p className="mt-1 text-xs text-slate-600">{connection.lastUsedAt ? t('Last used {date}', { date: formatDateTime(connection.lastUsedAt) }) : t('Not used yet')}</p>
      </div>
      {!revoked && <div className="flex flex-wrap gap-1">
        <Button variant="ghost" size="sm" disabled={update.isPending || revoke.isPending} onClick={edit}>{t('Edit expiration')}</Button>
        {!confirm && <Button variant="ghost" size="sm" disabled={update.isPending || revoke.isPending} onClick={() => { setError(null); setEditing(false); setConfirm(true); }}>{t('Revoke access')}</Button>}
      </div>}
    </div>
    {editing && <form className="mt-4 space-y-3" onSubmit={e => { e.preventDefault(); setError(null); update.mutate(); }}>
      <label htmlFor={`expiry-${connection.id}`} className="block text-sm text-ink">{t('Expiration (optional, your local time)')}</label>
      <input id={`expiry-${connection.id}`} type="datetime-local" className={inputClass} value={expiry} onChange={e => setExpiry(e.target.value)} />
      <p className="text-xs text-slate-600">{t('Leave empty to keep this key without expiration.')}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" loading={update.isPending}>{t('Save expiration')}</Button>
        <Button variant="ghost" size="sm" disabled={update.isPending} onClick={() => setEditing(false)}>{t('Cancel')}</Button>
      </div>
    </form>}
    {confirm && <div className="mt-4 space-y-3">
      <p className="text-sm text-slate-600">{t('This key will stop working. Invoices already received stay in Oli.')}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="danger" size="sm" loading={revoke.isPending} onClick={() => revoke.mutate()}>{t('Revoke access')}</Button>
        <Button variant="ghost" size="sm" disabled={revoke.isPending} onClick={() => setConfirm(false)}>{t('Cancel')}</Button>
      </div>
    </div>}
    {error && <div className="mt-3"><InlineAlert>{error}</InlineAlert></div>}
  </li>;
}

export function SkillIntegration() {
  const me = useMe(), qc = useQueryClient();
  const owner = me.data?.role === 'owner';
  const queryKey = ['integrations', 'skill', me.data?.org?.id];
  const query = useQuery({ queryKey, queryFn: () => api.getSkillIntegration(), enabled: owner, retry: false });
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'install' | 'connections'>('install');
  const [copiedSetup, setCopiedSetup] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey }); };
  const create = useMutation({ mutationFn: () => api.createSkillConnection(name.trim()), gcTime: 0,
    onMutate: () => { setError(null); setSecret(null); setCopied(false); },
    onSuccess: value => { setSecret(value.apiKey); setName(''); refresh(); create.reset(); },
    onError: e => setError(errorMessage(e)) });
  useEffect(() => {
    if (!secret) return;
    const timer = window.setTimeout(() => setSecret(null), 10 * 60 * 1000);
    return () => window.clearTimeout(timer);
  }, [secret]);
  const copy = async () => {
    if (!secret) return;
    try { await navigator.clipboard.writeText(secret); setCopied(true); }
    catch { setError(t('Could not copy the key. Select it and copy it manually.')); }
  };
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  const copySetup = async (kind: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopiedSetup(kind); }
    catch { setError(t('Could not copy. Select the text and copy it manually.')); }
  };
  const apiUrl = new URL(`${env.apiBase}/agent`, window.location.origin).href;
  const setup = skillSetup(apiUrl, new URL('/skills/oli-skill.tar.gz', window.location.origin).href);
  const close = () => { setOpen(false); setSecret(null); setError(null); setCopiedSetup(null); };
  return <>
    <Card className="mb-6 p-5 sm:p-8">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
          <Bot className="mt-1 size-8 shrink-0 text-ink" strokeWidth={1.5} aria-hidden />
          <div><h2 className="text-xl text-ink">Oli Skill</h2>
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-slate-600">{t('Let your AI agent send invoices to Oli. Oli checks your company’s rules and returns the decision and explanation.')}</p>
          </div>
        </div>
        <Button variant="secondary" className="shrink-0" onClick={() => setOpen(true)} icon={<ArrowUpRight className="size-4" aria-hidden />}>{t('Connect agent')}</Button>
      </div>
    </Card>
    <dialog ref={dialog} onCancel={close} onClose={close} aria-labelledby="oli-skill-title" className="fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-none w-full max-w-2xl overflow-hidden border-l border-hairline bg-paper p-0 text-ink backdrop:bg-black/30">
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-hairline p-5 sm:px-8 sm:py-6">
          <div><h2 id="oli-skill-title" className="text-xl">{t('Connect your agent to Oli')}</h2>
            <p className="mt-2 text-sm text-slate-600">{t('Install Oli Skill and keep financial decisions in Oli.')}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={close} aria-label={t('Close')} icon={<X className="size-5" aria-hidden />} />
        </div>
        <div className="flex shrink-0 gap-1 border-b border-hairline px-5 pt-3 sm:px-8" aria-label={t('Oli Skill sections')}>
          {(['install', 'connections'] as const).map(value => <Button key={value} variant="ghost" className={tab === value ? 'rounded-none border-b-2 border-ink' : 'rounded-none text-slate-600'} aria-pressed={tab === value} onClick={() => setTab(value)}>{t(value === 'install' ? 'Installation' : 'Connections')}</Button>)}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-8">
          {tab === 'install' ? <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-base">{t('Follow these steps')}</h3>
              <Button variant="secondary" size="sm" onClick={() => void copySetup('prompt', setup.prompt)} icon={copiedSetup === 'prompt' ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}>{t(copiedSetup === 'prompt' ? 'Copied' : 'Copy prompt')}</Button>
            </div>
            <p role="status" className="mt-3 text-sm leading-relaxed text-slate-600">{t('Paste the prompt into Hermes, OpenClaw, Grokbot or your agent. It will use its own installation method. Set the key in its secret manager.')}</p>
            <ol className="mt-7 space-y-8">
              <li>
                <h4 className="text-sm font-medium">{t('1. Install the skill')}</h4>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{t('Download and extract the package, then install the oli folder using your agent’s installation method. The copied prompt handles these steps for you.')}</p>
                <div className="mt-3 rounded-md bg-bone p-3">
                  <Button variant="ghost" size="sm" className="mb-2" onClick={() => void copySetup('install', setup.install)} icon={<Copy className="size-3.5" aria-hidden />}>{t(copiedSetup === 'install' ? 'Copied' : 'Copy commands')}</Button>
                  <pre className="overflow-x-auto text-xs leading-6" tabIndex={0}><code>{setup.install}</code></pre>
                </div>
                <a href="/skills/oli-skill.tar.gz" download className={buttonClass('ghost', 'sm', 'mt-2')}><Download className="size-4" aria-hidden />{t('Download Oli Skill')}</a>
                <p className="mt-2 text-xs text-slate-600">{t('Includes SKILL.md and a Python 3 client. Compatible with agents that support skills and HTTP requests.')}</p>
              </li>
              <li>
                <h4 className="text-sm font-medium">{t('2. Configure the connection')}</h4>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{t('Create a key for your agent. It has no expiration unless you set one.')}</p>
                <Button variant="secondary" size="sm" className="mt-3" onClick={() => setTab('connections')}>{t('Manage agent keys')}</Button>
                <div className="mt-3 rounded-md bg-bone p-3">
                  <Button variant="ghost" size="sm" className="mb-2" onClick={() => void copySetup('config', setup.configure)} icon={<Copy className="size-3.5" aria-hidden />}>{t(copiedSetup === 'config' ? 'Copied' : 'Copy configuration')}</Button>
                  <pre className="overflow-x-auto text-xs leading-6" tabIndex={0}><code>{setup.configure}</code></pre>
                </div>
              </li>
              <li>
                <h4 className="text-sm font-medium">{t('3. Send a fictitious invoice')}</h4>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{t('Ask your agent to send a PDF or photo to Oli and explain the result. Oli applies your rules and escalates exceptions to a person.')}</p>
              </li>
            </ol>
            <details className="mt-6 border-t border-hairline pt-4"><summary className="cursor-pointer text-sm">{t('View installation prompt')}</summary><pre className="mt-3 whitespace-pre-wrap break-words rounded-md bg-bone p-3 text-xs leading-6">{setup.prompt}</pre></details>
            {error && <div className="mt-4"><InlineAlert>{error}</InlineAlert></div>}
          </div> : <section aria-label={t('Agent connections')}>
            <p className="text-sm leading-relaxed text-slate-600">{t('Each key can submit invoices, request evaluation and read only the invoices it submitted. Human exceptions and rule changes stay in Oli.')}</p>
        {!owner ? <p className="mt-6 text-sm text-slate-600">{t('Ask an owner to create a key for your agent.')}</p>
          : query.isLoading ? <Skeleton className="mt-6 h-24" />
            : query.isError ? <div className="mt-6"><ErrorState error={query.error} onRetry={() => void query.refetch()} /></div>
              : <div className="mt-6">
                <form onSubmit={e => { e.preventDefault(); create.mutate(); }} className="space-y-3">
                  <label htmlFor="skill-agent-name" className="block text-sm text-ink">{t('Connection name')}</label>
                  <input id="skill-agent-name" value={name} onChange={e => setName(e.target.value)} required maxLength={80} placeholder={t('e.g. Hermes Marketing')} className={inputClass} />
                  <Button type="submit" loading={create.isPending} disabled={!name.trim() || secret !== null || env.apiMode === 'mock'}>{t('Create agent key')}</Button>
                  <p className="text-xs text-slate-600">{t('Keys have no expiration unless you set one. You can revoke them at any time.')}</p>
                  {env.apiMode === 'mock' && <p className="text-xs text-slate-600">{t('Connect to the live API to create an agent key.')}</p>}
                </form>
                {secret && <div className="mt-5 space-y-3 border-t border-hairline pt-4">
                  <label htmlFor="skill-api-key" className="block text-sm font-medium text-ink">{t('Copy your key now. It will only be shown once.')}</label>
                  <textarea id="skill-api-key" readOnly value={secret} rows={3} onFocus={e => e.currentTarget.select()} className={`${inputClass} resize-none font-mono`} spellCheck={false} autoComplete="off" />
                  <p className="text-xs text-slate-600">{t('Store it as OLI_API_KEY in your agent’s secret manager. Keep it out of chats and skill files.')}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => void copy()} icon={copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}>{t(copied ? 'Copied' : 'Copy key')}</Button>
                    <Button variant="ghost" onClick={() => setSecret(null)}>{t('I saved my key')}</Button>
                  </div>
                  <p role="status" className="text-xs text-slate-600">{t('This view hides the key after 10 minutes. Its access stays active.')}</p>
                </div>}
                {error && <div className="mt-4"><InlineAlert>{error}</InlineAlert></div>}
                <h3 className="mt-7 text-base text-ink">{t('Agent connections')}</h3>
                {!query.data?.connections.length ? <p className="mt-3 text-sm text-slate-600">{t('No agents connected yet. Create a key to connect your first agent.')}</p>
                  : <ul className="mt-3">{query.data.connections.map(connection => <ConnectionRow key={connection.id} connection={connection} refresh={refresh} />)}</ul>}
              </div>}
          </section>}
          <p className="mt-7 border-t border-hairline pt-4 text-xs leading-relaxed text-slate-600">{t('Demo only: use fictitious invoices. Approvals are simulated and no money moves.')}</p>
        </div>
      </div>
    </dialog>
  </>;
}
