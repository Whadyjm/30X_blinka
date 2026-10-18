import { useCallback, useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import { Oli, type OliState } from '@/components/Oli';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import { t } from '@/i18n';
import { OliTickle } from './OliTickle';
import '@/styles/chat-mascot.css';

const MOODS = ['listening', 'focused', 'happy', 'understanding'] as const;
const REACTIONS = ['celebrating', 'happy', 'understanding'] as const;

export function ChatMascot({ compact = false, state }: { compact?: boolean; state?: OliState }) {
  const reduced = usePrefersReducedMotion();
  const hint = useId();
  const [mood, setMood] = useState(0);
  const [reaction, setReaction] = useState<OliState | null>(null);
  const [tickled, setTickled] = useState<HTMLButtonElement | null>(null);
  const taps = useRef(0);
  const rapidTaps = useRef<number[]>([]);
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

  const finishTickle = useCallback(() => { setTickled(null); setReaction(null); }, []);

  const greet = (event: MouseEvent<HTMLButtonElement>) => {
    const now = performance.now();
    rapidTaps.current = [...rapidTaps.current.filter(at => now - at < 1500), now];
    clearTimeout(settle.current);
    if (rapidTaps.current.length >= 5) {
      rapidTaps.current = [];
      bounce.current?.cancel();
      setTickled(event.currentTarget);
      return;
    }
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

  const expression = state ?? reaction ?? MOODS[mood]!;
  return (
    <div className="flex shrink-0 flex-col items-center">
      <button type="button" className={`ask-oli-mascot${compact ? ' ask-oli-mascot--compact' : ''}`} onClick={greet}
        aria-label={t('Say hello to Oli')} aria-describedby={hint} data-oli-expression={expression}>
        <span className="ask-oli-float" aria-hidden="true" style={tickled ? { visibility: 'hidden' } : undefined}>
          <span ref={body} className="block">
            <Oli size={compact ? 104 : 224} particles={compact ? 1200 : 1800} state={expression} speed={0.85} paused={reduced} />
          </span>
        </span>
      </button>
      <p id={hint} role="status" className={compact ? 'sr-only' : 'mt-1 text-xs text-ash'}>{reaction ? t('Here I am!') : t('Tap Oli to say hello.')}</p>
      {tickled && <OliTickle source={tickled} reduced={reduced} onClose={finishTickle} />}
    </div>
  );
}
