import { useEffect, useRef, useState } from 'react';
import { Check, FileText, MessageCircle, ShieldCheck, ArrowUpRight } from 'lucide-react';
import { Oli, type OliState } from '@/components/Oli';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import { t } from '@/i18n';
import { cn } from '@/lib/cn';
import { OliTypedText } from './OliTypedText';
import { RULE_SECTIONS, VENDOR_SECTIONS } from './sections';

const FEATURES = [
  { title: 'Invoices', icon: FileText, heading: 'A home for every invoice.', body: 'Upload a PDF or image. I’ll read it, check your rules and explain the decision.', detail: 'Follow each invoice from arrival to decision, with its original document and history.' },
  { title: 'Approvals', icon: ShieldCheck, heading: 'Your judgment, when it matters.', body: 'When an allowed exception needs you, I’ll bring you the context to decide.', detail: 'Review the reason and the applicable rules before confirming. Hard stops stay blocked.' },
  { title: 'Chat with Oli', icon: MessageCircle, heading: 'Just ask me.', body: 'Ask about an invoice, understand a decision or prepare a change to your rules.', detail: 'I’ll ask you to confirm before applying a change. You stay in control.' },
] as const;

const GUIDANCE = [
  { title: 'Hi, I’m Oli.', body: 'I help you review invoices without losing sight of the details. Let’s set things up together.', hint: 'First, your workspace. Then, the rules we’ll follow.', state: 'happy' },
  { title: 'You set the boundaries.', body: 'Tell me what I can approve, what needs your attention and where I must stop.', hint: 'Your automatic limit is only one check. Every other rule must pass too.', state: 'understanding' },
  { title: 'Let’s meet your vendors.', body: 'Your vendor list tells me who is authorized. Agreements tell me what to expect on their invoices.', hint: 'Start with the sample set, or add your own fictional vendors and agreements.', state: 'listening' },
  { title: 'One last look, together.', body: 'These are the rules I’ll follow. Take your time: I’ll only activate them when you confirm.', hint: 'You can update your rules in Settings. Previous decisions keep their history.', state: 'focused' },
  { title: 'We’re ready to begin.', body: 'Your rules are active. Try a first invoice and follow its journey, or meet me on your dashboard.', hint: 'An uploaded invoice still needs to be read and checked. Received doesn’t mean approved.', state: 'celebrating' },
] as const;

export function OliGuide({ step, section, direction, state, name, busy, hasError, uploaded }: {
  step: number; section: number; direction: 'forward' | 'back'; state?: OliState; name: string; busy: boolean; hasError: boolean; uploaded: boolean;
}) {
  const [feature, setFeature] = useState(0);
  const reduced = usePrefersReducedMotion();
  const guide = GUIDANCE[step] ?? GUIDANCE[0];
  const message = (step === 1 ? RULE_SECTIONS[section] : step === 2 ? VENDOR_SECTIONS[section] : undefined) ?? guide;
  const selected = FEATURES[feature] ?? FEATURES[0];
  const Icon = selected.icon;
  const currentState = busy ? 'thinking' : hasError ? 'focused' : state ?? (uploaded ? 'happy' : message.state);
  const oliBox = useRef<HTMLDivElement>(null);
  // A small acknowledgement whenever Oli's expression changes; skipped on first paint and with Reduce Motion.
  const previous = useRef(currentState);
  useEffect(() => {
    if (previous.current === currentState) return;
    previous.current = currentState;
    if (reduced || !oliBox.current?.animate) return;
    const pulse = oliBox.current.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.05)', offset: 0.4 }, { transform: 'scale(1)' }],
      { duration: 480, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
    return () => pulse.cancel();
  }, [currentState, reduced]);
  const status = busy ? 'Working on it…' : hasError ? 'Let’s take another look' : state === 'listening' ? 'I’m listening' : step === 4 ? 'Ready when you are' : 'Here with you';

  return (
    <aside className="onboarding-guide" aria-label={t('Your guide, Oli')} data-oli-state={currentState}>
      <div className="onboarding-oli" aria-hidden="true">
        {step === 4 && !reduced && (
          <span className="onboarding-burst">{Array.from({ length: 10 }, (_, i) => <i key={i} style={{ '--a': `${i * 36}deg` } as React.CSSProperties} />)}</span>
        )}
        <div ref={oliBox} className="onboarding-oli-pulse">
        <Oli state={currentState} size={280} particles={1800} speed={0.7} paused={reduced} followCursor />
        </div>
      </div>
      <div className="onboarding-guide-copy oli-speech-bubble" key={`copy-${step}-${section}`} data-direction={direction}>
        <h2><OliTypedText text={step === 0 && name.trim() ? t('Hi {name}, I’m Oli.', { name: name.trim() }) : t(message.title)} /></h2>
        <p className="onboarding-guide-message"><OliTypedText text={t(message.body)} delay={Array.from(t(message.title)).length * 18 + 80} /></p>
        <p className="onboarding-oli-status" role="status"><span aria-hidden="true" />{t(status)}</p>
      </div>

      {step === 0 ? (
        <div className="onboarding-features">
          <div className="onboarding-feature-controls" role="group" aria-label={t('Explore what Oli can do')}>
            {FEATURES.map((item, index) => (
              <button key={item.title} type="button" aria-pressed={feature === index} onClick={() => setFeature(index)} className={cn('onboarding-feature-button', feature === index && 'is-selected')}>
                <item.icon className="size-4" aria-hidden="true" />{t(item.title)}
              </button>
            ))}
          </div>
          <div className="onboarding-feature-preview" key={`feature-${feature}`} aria-live="polite" aria-atomic="true">
            <div className="onboarding-feature-example" aria-hidden="true">
              <Icon className="size-5" />
              <span>{t(feature === 0 ? 'Document → checks → decision' : feature === 1 ? 'Context → your review → confirmation' : 'Your question → a clear explanation')}</span>
              <ArrowUpRight className="size-4 shrink-0" />
            </div>
            <h3>{t(selected.heading)}</h3>
            <p>{t(selected.body)}</p>
            <p className="onboarding-feature-detail">{t(selected.detail)}</p>
          </div>
        </div>
      ) : (
        <div className="onboarding-guide-note" key={`note-${step}`}>
          <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>{t(guide.hint)}</p>
        </div>
      )}
    </aside>
  );
}
