import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Element, Root, RootContent } from 'hast';
import { describe, expect, it } from 'vitest';
import { ChatText } from '../../src/features/chat/ChatText';
import { wordReveal, wordRevealInterval } from '../../src/features/chat/word-reveal';

const plain = (node: Root | RootContent): string => node.type === 'text' ? node.value : 'children' in node ? node.children.map(plain).join('') : '';
describe('word reveal', () => {
  it('preserves exact Unicode text, whitespace and Markdown structure', () => {
    const link: Element = { type: 'element', tagName: 'a', properties: { href: '/app/bills' }, children: [{ type: 'text', value: 'tus facturas' }] };
    const tree: Root = { type: 'root', children: [{ type: 'element', tagName: 'p', properties: {}, children: [{ type: 'text', value: 'Hola, Oli.\n  Revisé €50 👋 ' }, link] }] };
    const original = plain(tree); wordReveal()(tree);
    expect(plain(tree)).toBe(original);
    expect(link.properties.href).toBe('/app/bills');
    expect(link.children).toHaveLength(3);
    expect(link.children[0]).toMatchObject({ type: 'element', tagName: 'span', properties: { className: ['chat-reply-word'] } });
  });
  it('leaves history unwrapped and retains normal Markdown formatting', () => {
    const html = renderToStaticMarkup(createElement(ChatText, { text: 'Ya revisé **tu factura**.' }));
    expect(html).toContain('<strong>tu factura</strong>');
    expect(html).not.toContain('chat-reply-word');
  });
  it('reveals formatted text without enabling HTML, remote images or unsafe links', () => {
    const html = renderToStaticMarkup(createElement(ChatText, { animate: true, text: '**Hola** [facturas](/app/bills) ![remoto](https://example.invalid/image.png) <script>alert(1)</script> [malo](javascript:alert)' }));
    expect(html).toContain('chat-reply-word'); expect(html).toContain('<strong>'); expect(html).toContain('href="/app/bills"');
    for (const unsafe of ['<script', '<img', 'image.png', 'href="javascript:']) expect(html).not.toContain(unsafe);
  });
  it('keeps short replies fluid and caps long replies at six seconds', () => {
    expect(wordRevealInterval(20)).toBe(34);
    expect(wordRevealInterval(2000) * 2000).toBeLessThanOrEqual(6000);
    expect(Number.isFinite(wordRevealInterval(0))).toBe(true);
  });
});
