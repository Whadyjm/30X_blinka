import { useEffect, useId, useRef, useState } from 'react';
import { Oli, type OliState } from '@/components/Oli';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import { t } from '@/i18n';
import '@/styles/chat-mascot.css';

const MOODS = ['listening', 'focused', 'happy', 'understanding'] as const;
const REACTIONS = ['celebrating', 'happy', 'understanding'] as const;

export function ChatMascot() {
  const reduced = usePrefersReducedMotion();
  const hint = useId();
  const [mood, setMood] = useState(0);
  const [reaction, setReaction] = useState<OliState | null>(null);
  const taps = useRef(0);
  const body = useRef<HTMLSpanElement>(null);
  const bounce = useRef<Animation | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    clearTimeout(settle.current);
    bounce.current?.cancel();
    setReaction(null);
    setMood(0);
    if (reduced) return;
    const timer = setInterval(() => {
      if (!document.hidden) setMood(current => (current + 1) % MOODS.length);
    }, 5200);
    return () => clearInterval(timer);
  }, [reduced]);

  useEffect(() => () => {
    clearTimeout(settle.current);
    bounce.current?.cancel();
  }, []);

  const greet = () => {
    clearTimeout(settle.current);
    setReaction(REACTIONS[taps.current++ % REACTIONS.length]!);
    bounce.current?.cancel();
    if (!reduced && body.current?.animate) {
      bounce.current = body.current.animate([
        { transform: 'scale(1) rotate(0deg)' },
        { transform: 'scale(1.08, 0.88) rotate(-5deg)', offset: 0.22 },
        { transform: 'translateY(-12px) scale(0.96, 1.06) rotate(4deg)', offset: 0.55 },
        { transform: 'scale(1) rotate(0deg)' },
      ], { duration: 640, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    }
    settle.current = setTimeout(() => setReaction(null), reduced ? 1200 : 2600);
  };

  const expression = reaction ?? MOODS[mood]!;
  return (
    <div className="flex shrink-0 flex-col items-center">
      <button type="button" className="ask-oli-mascot" onClick={greet}
        aria-label={t('Say hello to Oli')} aria-describedby={hint} data-oli-expression={expression}>
        <span className="ask-oli-float" aria-hidden="true">
          <span ref={body} className="block">
            <Oli size={224} particles={1800} state={expression} speed={0.85} paused={reduced} />
          </span>
        </span>
      </button>
      <p id={hint} role="status" className="mt-1 text-xs text-ash">{reaction ? t('Here I am!') : t('Tap Oli to say hello.')}</p>
    </div>
  );
}
