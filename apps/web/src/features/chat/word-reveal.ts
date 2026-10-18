import type { Element, Root, RootContent } from 'hast';

/** Wrap rendered text, so revealing words never exposes unfinished Markdown syntax. */
export function wordReveal() {
  return (tree: Root) => {
    const visit = (parent: Root | Element) => {
      parent.children = parent.children.flatMap((node): RootContent[] => {
        if (node.type === 'text') return (node.value.match(/\s+|\S+/gu) ?? []).map(value => /^\s+$/u.test(value)
          ? { type: 'text', value }
          : { type: 'element', tagName: 'span', properties: { className: ['chat-reply-word'] }, children: [{ type: 'text', value }] });
        if (node.type === 'element') visit(node);
        return [node];
      });
    };
    visit(tree);
  };
}

// Keep a conversational pace for short replies without making long replies take forever.
export const wordRevealInterval = (words: number) => Math.min(34, 6000 / Math.max(1, words));
