import { useLayoutEffect, useRef } from 'react';
import Markdown from 'react-markdown';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import { wordReveal, wordRevealInterval } from './word-reveal';

const revealPlugins = [wordReveal];

/** Render model text as a bounded Markdown subset. HTML and remote images never render. */
export function ChatText({ text, animate = false, onRevealProgress, onRevealDone }: { text: string; animate?: boolean; onRevealProgress?: () => void; onRevealDone?: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const reveal = animate && !reduced;
  useLayoutEffect(() => {
    const element = root.current;
    if (!reveal || !element) { if (animate) onRevealDone?.(); return; }
    const words = [...element.querySelectorAll<HTMLElement>('.chat-reply-word')];
    if (!words.length) { onRevealDone?.(); return; }
    words.forEach(word => { word.hidden = true; });
    // Announce the completed reply once, rather than each visual word.
    element.setAttribute('aria-busy', 'true');
    const start = performance.now(), interval = wordRevealInterval(words.length);
    let shown = 0, frame = 0, finish = 0;
    const tick = (now: number) => {
      const next = Math.min(words.length, 1 + Math.floor((now - start) / interval));
      if (next > shown) {
        while (shown < next) { const word = words[shown++]!; word.hidden = false; word.classList.add('is-revealed'); }
        onRevealProgress?.();
      }
      if (shown < words.length) frame = requestAnimationFrame(tick);
      else {
        element.setAttribute('aria-busy', 'false');
        finish = window.setTimeout(() => onRevealDone?.(), 180);
      }
    };
    tick(start);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(finish);
      words.forEach(word => { word.hidden = false; word.classList.remove('is-revealed'); });
      element.setAttribute('aria-busy', 'false');
    };
  }, [text, animate, reveal, onRevealProgress, onRevealDone]);
  return <div ref={root} className="chat-prose min-w-0 [overflow-wrap:anywhere]" aria-live={reveal ? 'polite' : undefined} aria-atomic={reveal ? true : undefined}>
    <Markdown skipHtml rehypePlugins={reveal ? revealPlugins : undefined} allowedElements={['p', 'strong', 'em', 'ul', 'ol', 'li', 'a', 'code', 'pre', 'br', 'blockquote', 'h1', 'h2', 'h3', 'hr', 'span']}
      components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">{children}</a> }}>
      {text}
    </Markdown>
  </div>;
}
