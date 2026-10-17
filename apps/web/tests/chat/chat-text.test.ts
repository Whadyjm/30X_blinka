import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { ChatText } from '../../src/features/chat/ChatText';

it('renders paragraphs, emphasis and lists while excluding HTML, scripts, tracking images and unsafe links', () => {
  const html = renderToStaticMarkup(createElement(ChatText, { text: 'Claro, vamos **paso a paso**.\n\n- Nombre del proveedor\n- ¿Quieres permitir sus facturas?\n\n<script>alert("x")</script>\n\n![tracking](https://remote.invalid/pixel.png)\n\n[unsafe](javascript:alert(1))' }));
  expect(html).toContain('<strong>paso a paso</strong>'); expect(html).toContain('<ul>'); expect(html).toContain('<li>Nombre del proveedor</li>');
  expect(html).not.toContain('**'); expect(html).not.toContain('<script'); expect(html).not.toContain('<img'); expect(html).not.toContain('href="javascript:');
});
