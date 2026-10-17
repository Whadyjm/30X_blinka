import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChatAction, ChatActionResult, ChatCard, ChatReply as Reply } from '@oli/contracts';
import { api, errorMessage } from '@/api';
import { invoiceView } from '@/api/view-model';
import { Button } from '@/components/ui/Button';
import { InvoiceList } from '@/features/invoices/InvoiceList';
import { invalidateMoney, qk, useMe } from '@/hooks/queries';
import { t } from '@/i18n';
import { formatDateTime } from '@/lib/dates';
import { formatMoney } from '@/lib/money';

export function ChatReply({ reply }: { reply: Reply }) {
  return <div className="min-w-0 space-y-3 [overflow-wrap:anywhere]">
    <p className="whitespace-pre-wrap">{reply.text}</p>
    {reply.cards.map((card, i) => <ChatCardView key={i} card={card} />)}
    {reply.actions.map(action => <ActionReview key={action.id} snapshot={action} />)}
  </div>;
}

const intakeLabels = {
  PROCESSING: 'Processing', FAILED: 'Failed', EXTRACTION_REVIEW: 'Document needs clarification',
  UNKNOWN_VENDOR: 'Vendor not registered', DISALLOWED_VENDOR: 'Vendor not authorized',
  AMBIGUOUS_VENDOR: 'Vendor identity needs clarification', KNOWN_VENDOR: 'Known vendor',
};

export function ChatCardView({ card }: { card: ChatCard }) {
  if (card.type === 'INVOICE') return <InvoiceCard snapshot={card} />;
  if (card.type === 'INVOICES') return <div className="min-w-0 overflow-x-auto">
    {card.invoices.length ? <InvoiceList invoices={card.invoices.map(invoiceView)} compact /> : <p>{t('No matching records.')}</p>}
    {card.truncated && <p>{t('More records are available in Bills.')}</p>}
  </div>;
  if (card.type === 'BUDGET') return <div className="space-y-2">
    <p>{t('Budget')} · {card.periodKey}</p>
    {card.budgets.length === 0 && <p>{t('No matching records.')}</p>}
    {card.budgets.map(budget => <dl key={budget.id} className="space-y-1 text-sm">
      <Fact label={t('Limit')} value={formatMoney(budget.limitMinor, budget.currency)} />
      <Fact label={t('Reserved')} value={formatMoney(budget.reservedMinor, budget.currency)} />
      <Fact label={t('Available')} value={formatMoney(budget.availableMinor, budget.currency)} />
    </dl>)}
  </div>;
  if (card.type === 'SPEND') return <div className="space-y-2">
    <p>{card.periodKey} · {t('Extracted invoice amounts; these are not payments.')}</p>
    <p className="text-xs">{t('Grouped by service period or issue month. Uncertain readings remain unverified.')}</p>
    {card.totals.length === 0 && <p>{t('No matching records.')}</p>}
    {card.totals.map(total => <dl key={total.currency} className="space-y-1 text-sm">
      <Fact label={t('Invoices')} value={String(total.count)} />
      <Fact label={t('Invoiced')} value={formatMoney(total.invoicedMinor, total.currency)} />
      <Fact label={t('Approved')} value={formatMoney(total.approvedMinor, total.currency)} />
      <Fact label={t('Blocked')} value={formatMoney(total.blockedMinor, total.currency)} />
    </dl>)}
  </div>;
  const entries = card.type === 'VENDORS' ? card.vendors : card.agreements;
  return <div>
    {!entries.length && <p>{t('No matching records.')}</p>}
    <ul className="space-y-2">{entries.map(entry => <li key={entry.id}>
      {'name' in entry ? <>{entry.name} · {t(entry.allowed ? 'Authorized' : 'Not authorized')}</>
        : <>{entry.concept} · {formatMoney(entry.amountMinor, entry.currency)} · {t(entry.active ? 'Active' : 'Inactive')}</>}
    </li>)}</ul>
    {card.truncated && <p>{t('More records are available in Rules.')}</p>}
    <Link to="/app/rules" className="underline underline-offset-2">{t('View rules and limits')}</Link>
  </div>;
}

function InvoiceCard({ snapshot }: { snapshot: Extract<ChatCard, { type: 'INVOICE' }> }) {
  const started = useRef(Date.now());
  const live = useQuery({ queryKey: ['invoice-intake', snapshot.invoice.id], queryFn: () => api.getInvoiceIntake(snapshot.invoice.id),
    initialData: snapshot, enabled: snapshot.intake.status === 'PROCESSING', retry: false,
    refetchInterval: query => query.state.data?.intake.status === 'PROCESSING' && Date.now() - started.current < 60000 ? 2000 : false });
  const card = live.data;
  return <div className="min-w-0 overflow-x-auto space-y-2">
    <p>{t(intakeLabels[card.intake.status])}</p>
    <InvoiceList invoices={[invoiceView(card.invoice)]} compact />
    {card.intake.status === 'PROCESSING' && <Button size="sm" variant="secondary" loading={live.isFetching} onClick={() => { started.current = Date.now(); void live.refetch(); }}>{t('Refresh')}</Button>}
    {live.isError && <p role="alert">{errorMessage(live.error)}</p>}
  </div>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="flex flex-wrap justify-between gap-x-4 gap-y-1"><dt>{label}</dt><dd className="font-medium">{value}</dd></div>;
}

const fieldLabels: Record<string, string> = {
  name: 'Vendor name', allowed: 'Authorized', externalRef: 'External reference', vendorId: 'Vendor ID',
  concept: 'Concept', currency: 'Currency', amountMinor: 'Amount', toleranceMinor: 'Tolerance',
  frequency: 'Frequency', active: 'Active', invoiceId: 'Invoice', expectedDecisionId: 'Decision',
};
function ProposalFields({ fields }: { fields: Record<string, unknown> }) {
  return <dl className="space-y-1 text-sm">{Object.entries(fields).filter(([key]) => key in fieldLabels).map(([key, value]) =>
    <Fact key={key} label={t(fieldLabels[key]!)} value={typeof value === 'boolean' ? t(value ? 'Yes' : 'No')
      : key.endsWith('Minor') && typeof value === 'number' ? formatMoney(value, typeof fields.currency === 'string' ? fields.currency : undefined)
      : value == null ? '—' : key === 'frequency' ? t(String(value)) : String(value)} />)}</dl>;
}
const actionLabels = {
  CREATE_VENDOR: 'Register vendor', UPDATE_VENDOR: 'Update vendor', CREATE_AGREEMENT: 'Create agreement',
  UPDATE_AGREEMENT: 'Update agreement', ONBOARD_INVOICE_VENDOR: 'Register vendor and review invoice', RESUME_INVOICE: 'Review invoice again',
};
function ActionReview({ snapshot }: { snapshot: ChatAction }) {
  const me = useMe();
  const qc = useQueryClient();
  const current = useQuery({ queryKey: ['chat-action', snapshot.id], queryFn: () => api.getChatAction(snapshot.id), retry: false,
    refetchInterval: q => q.state.data?.status === 'PENDING' ? 5000 : false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ChatActionResult | null>(null);
  const action = current.data ?? snapshot;
  const p = action.proposal;
  const actionable = me.data?.role === 'owner' && !!current.data && !current.isError && !current.isFetching && !busy
    && action.status === 'PENDING' && Date.parse(action.expiresAt) > Date.now();
  const mutate = async (confirm: boolean) => {
    if (!actionable) return;
    setBusy(true); setError(null);
    try {
      if (confirm) { const saved = await api.confirmChatAction(action.id); setResult(saved); qc.setQueryData(['chat-action', action.id], saved.action); }
      else qc.setQueryData(['chat-action', action.id], await api.cancelChatAction(action.id));
    } catch (e) { setError(errorMessage(e)); }
    finally {
      setBusy(false); void current.refetch();
      void invalidateMoney(qc); void qc.invalidateQueries({ queryKey: qk.vendors }); void qc.invalidateQueries({ queryKey: qk.agreements }); void qc.invalidateQueries({ queryKey: ['invoice-intake'] });
    }
  };
  return <section className="space-y-3 border-t border-hairline pt-3" aria-label={t('Proposed change')}>
    <h3 className="font-medium">{t(actionLabels[p.kind])}</h3>
    {action.before && <div><p className="mb-1 text-xs">{t('Before')}</p><ProposalFields fields={action.before} /></div>}
    <div><p className="mb-1 text-xs">{t('Proposed')}</p>
      {'data' in p && <ProposalFields fields={{ ...action.before, ...p.data }} />}
      {p.kind === 'ONBOARD_INVOICE_VENDOR' && <><ProposalFields fields={p.vendor} />{p.agreement && <ProposalFields fields={p.agreement} />}</>}
      {'invoiceId' in p && <Link to={`/app/bills/${encodeURIComponent(p.invoiceId)}`} className="underline">{t('View invoice')}</Link>}
    </div>
    <p className="text-xs">{t(action.status)} · {t('Expires')}: {formatDateTime(action.expiresAt)}</p>
    {action.status === 'PENDING' && <p className="text-xs">{t('Review the proposed values. Nothing changes until you confirm.')}</p>}
    {me.data?.role === 'owner' && action.status === 'PENDING' && <div className="flex flex-wrap gap-2">
      <Button size="sm" disabled={!actionable} loading={busy} onClick={() => void mutate(true)}>{t('Confirm change')}</Button>
      <Button size="sm" variant="secondary" disabled={!actionable} onClick={() => void mutate(false)}>{t('Cancel')}</Button>
    </div>}
    {(error || current.isError) && <div role="alert" className="space-y-2"><p>{error ?? errorMessage(current.error)}</p><Button size="sm" variant="secondary" onClick={() => void current.refetch()}>{t('Refresh')}</Button></div>}
    {result?.invoice && <InvoiceList invoices={[invoiceView(result.invoice)]} compact />}
  </section>;
}
