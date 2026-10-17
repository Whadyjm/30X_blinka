import { describe, expect, it, vi } from 'vitest';
import { createHttpApi } from '../../src/api/http-api';
import { ContractError } from '../../src/api/errors';
import type { ChatAction, ChatReply } from '@oli/contracts';

const stamp = '2026-10-17T12:00:00.000Z';
const session = { user: { id: 'owner', name: 'Demo', email: 'owner@example.invalid' }, organization: {
  id: 'org-demo', name: 'Empresa ficticia', defaultCurrency: 'USD', timezone: 'America/Caracas' }, role: 'OWNER', csrfToken: 'csrf-test' };
const reply: ChatReply = { conversationId: 'conversation-original', turnId: 'turn-original', text: 'Respuesta real del servidor',
  cards: [], actions: [], createdAt: stamp, model: 'deepseek/deepseek-v4.1-flash' };
const action: ChatAction = { id: 'action-demo', status: 'PENDING', before: null,
  proposal: { kind: 'CREATE_VENDOR', data: { name: 'Proveedor ficticio', allowed: false, externalRef: null } }, createdAt: stamp, expiresAt: stamp };
const response = (data: unknown) => Response.json({ data });

describe('real conversation HTTP contract', () => {
  it('sends every suggestion verbatim through /chat/messages with session, CSRF and the retained UUID', async () => {
    const calls: Array<{ body: unknown; key: string | null }> = [];
    let lose = true;
    const api = createHttpApi({ base: '/api/v1', fetchImpl: async (url, init) => {
      if (String(url).endsWith('/me')) return response(session);
      expect(String(url)).toBe('/api/v1/chat/messages');
      const headers = new Headers(init?.headers);
      expect(headers.get('X-CSRF-Token')).toBe('csrf-test'); expect(init?.credentials).toBe('include');
      calls.push({ body: JSON.parse(String(init?.body)), key: headers.get('Idempotency-Key') });
      if (lose) { lose = false; throw new TypeError('lost response'); } return response(reply);
    } });
    const key = crypto.randomUUID();
    const input = { conversationId: null, text: '¿Qué facturas necesitan mi revisión?', invoiceIds: [] };
    await expect(api.sendChatMessage(input, key)).rejects.toMatchObject({ code: 'NETWORK' });
    expect(await api.sendChatMessage(input, key)).toEqual(reply); expect(calls[0]).toEqual(calls[1]);
    await api.sendChatMessage({ ...input, text: '¿Hay facturas bloqueadas o rechazadas?' }, crypto.randomUUID());
    expect(calls[2]!.body).toMatchObject({ text: '¿Hay facturas bloqueadas o rechazadas?' });
  });
  it('rejects malformed replies and invalid input rather than presenting a local fallback', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async url => String(url).endsWith('/me') ? response(session) : response({ ...reply, cards: [{ type: 'invented' }] }));
    const api = createHttpApi({ base: '/api/v1', fetchImpl });
    await expect(api.sendChatMessage({ conversationId: null, text: 'hola', invoiceIds: [] }, crypto.randomUUID())).rejects.toBeInstanceOf(ContractError);
    const count = fetchImpl.mock.calls.length;
    await expect(api.sendChatMessage({ conversationId: null, text: 'x'.repeat(4001), invoiceIds: [] }, crypto.randomUUID())).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(count);
  });
  it('fetches private history/action state and sends only explicit confirmation, retaining its key after a lost response', async () => {
    const confirmations: Array<{ key: string | null; body: unknown }> = [];
    const paths: string[] = [];
    const api = createHttpApi({ base: '/api/v1', fetchImpl: async (url, init) => {
      const path = String(url); paths.push(path);
      if (path.endsWith('/me')) return response(session);
      if (path.endsWith('/chat/conversations')) return response([{ id: reply.conversationId, createdAt: stamp, updatedAt: stamp }]);
      if (path.includes('/chat/conversations/')) return response({ id: reply.conversationId, turns: [] });
      if (path.endsWith('/confirm')) {
        const headers = new Headers(init?.headers); expect(headers.get('X-CSRF-Token')).toBe('csrf-test');
        confirmations.push({ key: headers.get('Idempotency-Key'), body: JSON.parse(String(init?.body)) });
        if (confirmations.length === 1) throw new TypeError('lost confirm response');
        return response({ action: { ...action, status: 'CONFIRMED' }, vendor: null, agreement: null, invoice: null });
      }
      if (path.endsWith('/cancel')) return response({ ...action, status: 'CANCELLED' });
      return response(action);
    } });
    await api.listChatConversations(); await api.getChatHistory('id/with slash'); await api.getChatAction(action.id);
    expect(confirmations).toHaveLength(0); expect(paths).toContain('/api/v1/chat/conversations/id%2Fwith%20slash');
    await expect(api.confirmChatAction(action.id)).rejects.toMatchObject({ code: 'NETWORK' });
    expect((await api.confirmChatAction(action.id)).action.status).toBe('CONFIRMED');
    expect(confirmations[0]).toEqual(confirmations[1]); expect(confirmations[1]!.body).toEqual({ confirmed: true });
    expect((await api.cancelChatAction(action.id)).status).toBe('CANCELLED');
  });
});
