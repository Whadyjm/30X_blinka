import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChatMessageInputSchema, type ChatChannel, type ChatReply } from '@oli/contracts';
import { api, ApiError, errorMessage } from '@/api';
import { invalidateMoney } from '@/hooks/queries';
import { submitChat, type Submission } from './submission';

export function useConversation(scope: string, channel: ChatChannel = 'WEB') {
  const qc = useQueryClient();
  const [selection, setSelection] = useState<{ scope: string; id: string | null }>();
  const [pending, setPending] = useState<Submission | null>(null);
  const operation = useRef<Submission | null>(null);
  const locked = useRef(false);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [freshReply, setFreshReply] = useState<{ scope: string; turnId: string } | null>(null);
  const finishReveal = useCallback((turnId: string) => setFreshReply(current => current?.turnId === turnId ? null : current), []);
  const storageKey = `oli.chat.pending:${scope}:${channel}`;
  const conversations = useQuery({ queryKey: ['chat-conversations', scope, channel], queryFn: () => api.listChatConversations(channel), retry: false, enabled: !!scope,
    refetchInterval: channel === 'TELEGRAM' ? 5000 : false });
  const selected = selection?.scope === scope ? selection.id : undefined;
  const id = selected === undefined ? conversations.data?.[0]?.id ?? null : selected;
  const historyKey = ['chat-history', scope, channel, id];
  const history = useQuery({ queryKey: historyKey, queryFn: () => api.getChatHistory(id!), enabled: !!id, retry: false,
    refetchInterval: q => channel === 'TELEGRAM' ? 5000 : q.state.data?.turns.some(turn => turn.state === 'PROCESSING') ? 2000 : false });

  // Persist only a fully prepared command; file bytes and credentials never enter browser storage.
  useEffect(() => {
    if (!scope || channel !== 'WEB') return;
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
      const input = ChatMessageInputSchema.safeParse(saved?.input);
      if (input.success && typeof saved.key === 'string' && /^[\da-f-]{36}$/i.test(saved.key)) {
        const restored: Submission = { key: saved.key, input: input.data, text: input.data.text, conversationId: input.data.conversationId, files: [] };
        operation.current = restored; setPending(restored);
      }
    } catch { /* Browser storage is optional; in-memory retries still retain the same command. */ }
  }, [storageKey, scope, channel]);

  const checkpoint = () => {
    const current = operation.current;
    if (!current) return;
    setPending({ ...current, files: [...current.files] });
    if (current.input) {
      try { sessionStorage.setItem(storageKey, JSON.stringify({ key: current.key, input: current.input })); } catch { /* Optional storage. */ }
    }
  };

  const clearPending = () => {
    operation.current = null; setPending(null);
    try { sessionStorage.removeItem(storageKey); } catch { /* Optional storage. */ }
  };

  const deliver = async () => {
    if (locked.current || !operation.current) return;
    locked.current = true; setSending(true); setFailure(null);
    try {
      const current = operation.current;
      const reply = await submitChat(api, current, checkpoint);
      rememberReply(reply, current);
      clearPending();
    } catch (error) {
      setFailure(error);
      if (error instanceof ApiError && error.code === 'CHAT_RETRY_LIMIT') {
        clearPending();
        if (id) void history.refetch();
        void conversations.refetch();
      }
    } finally {
      locked.current = false; setSending(false);
      void invalidateMoney(qc);
    }
  };

  function rememberReply(reply: ChatReply, current: Submission) {
    setFreshReply({ scope, turnId: reply.turnId });
    setSelection({ scope, id: reply.conversationId });
    qc.setQueryData(['chat-history', scope, channel, reply.conversationId], (old: typeof history.data) => ({ id: reply.conversationId, channel,
      turns: [...(old?.turns ?? []).filter(turn => turn.id !== reply.turnId), {
        id: reply.turnId, text: current.input!.text, invoiceIds: current.input!.invoiceIds,
        state: 'COMPLETED' as const, reply, errorCode: null, createdAt: reply.createdAt,
      }].slice(-20) }));
    void qc.invalidateQueries({ queryKey: ['chat-conversations', scope, channel] });
    void qc.invalidateQueries({ queryKey: ['chat-history', scope, channel, reply.conversationId] });
  }

  const processing = history.data?.turns.some(turn => turn.state === 'PROCESSING') ?? false;
  const loading = conversations.isLoading || (!!id && history.isLoading);
  return {
    id, conversations: conversations.data ?? [], revealTurnId: freshReply?.scope === scope ? freshReply.turnId : null, finishReveal,
    turns: history.data?.turns ?? [], pending, sending, loading, processing,
    error: failure ? errorMessage(failure) : conversations.error ? errorMessage(conversations.error) : history.error ? errorMessage(history.error) : null,
    canRetry: !(failure instanceof ApiError && failure.code === 'CHAT_RETRY_LIMIT'),
    canSend: channel === 'WEB' && !!scope && !loading && !sending && !processing && !pending && !conversations.isError && !history.isError,
    async send(text: string, files: File[]) {
      if (channel !== 'WEB' || locked.current || operation.current) return;
      operation.current = { key: crypto.randomUUID(), text: text.trim(), conversationId: id,
        files: files.map(file => ({ file, key: crypto.randomUUID() })) };
      checkpoint(); await deliver();
    },
    dismiss() {
      if (locked.current) return;
      clearPending(); setFailure(null);
      if (id) void history.refetch();
      void conversations.refetch();
    },
    retry: () => operation.current ? deliver() : conversations.isError || !id ? conversations.refetch() : history.refetch(),
    selectConversation(next: string) { if (!locked.current && !operation.current && conversations.data?.some(c => c.id === next && c.channel === channel)) { setFreshReply(null); setSelection({ scope, id: next }); setFailure(null); } },
    newConversation() { if (channel === 'WEB' && !locked.current) { clearPending(); setFreshReply(null); setSelection({ scope, id: null }); setFailure(null); } },
  };
}
