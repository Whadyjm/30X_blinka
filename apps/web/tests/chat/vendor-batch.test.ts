import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ChatReply as Reply } from '@oli/contracts';
import { ChatReply } from '../../src/features/chat/ChatReply';
import { chatFailureMessage } from '../../src/features/chat/failure-message';
import { applyLang } from '../../src/i18n';

it('renders all proposed vendor names and explicit permissions before batch confirmation', () => {
  const stamp = '2026-10-18T12:00:00Z';
  const vendors = Array.from({ length: 13 }, (_, i) => ({ name: `Proveedor lote ${i}`, allowed: i !== 12, externalRef: null }));
  const reply: Reply = { conversationId: 'chat', turnId: 'turn', text: 'Revisa la lista', cards: [],
    actions: [{ id: 'batch', before: null, status: 'PENDING', createdAt: stamp, expiresAt: stamp,
      proposal: { kind: 'CREATE_VENDORS', vendors } }], createdAt: stamp, model: 'deepseek/deepseek-v4.1-flash' };
  const client = new QueryClient();
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client },
    createElement(MemoryRouter, null, createElement(ChatReply, { reply }))));
  for (const vendor of vendors) expect(html).toContain(vendor.name);
  expect(html).not.toContain('CREATE_VENDORS');
  client.clear();
});

it('a failed turn still explains the tool limit after reloading its history', () => {
  applyLang('es');
  expect(chatFailureMessage('CHAT_TOOL_LIMIT')).toContain('límite de consultas o propuestas');
  expect(chatFailureMessage('CHAT_TOOL_LIMIT')).toContain('hasta 20 proveedores');
  expect(chatFailureMessage('CHAT_TOOL_LIMIT')).toContain('No se ejecutó ningún cambio');
  expect(chatFailureMessage('CHAT_UNAVAILABLE')).not.toContain('CHAT_UNAVAILABLE');
});
