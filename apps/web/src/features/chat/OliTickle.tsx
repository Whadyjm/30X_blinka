import { useId, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Oli } from '@/components/Oli';
import { t } from '@/i18n';

export function OliTickle({ source, reduced, onClose }: { source: HTMLButtonElement; reduced: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const character = useRef<HTMLDivElement>(null);
  const dismiss = useRef<() => void>(() => {});
  const message = useId();

  useLayoutEffect(() => {
    const overlay = dialog.current!, mascot = character.current!;
    overlay.showModal();
    const origin = () => {
      const from = source.getBoundingClientRect(), to = mascot.getBoundingClientRect();
      return `translate(${from.left + from.width / 2 - to.left - to.width / 2}px, ${from.top + from.height / 2 - to.top - to.height / 2}px) scale(${from.width / to.width})`;
    };
    let animation = reduced ? undefined : mascot.animate([
      { transform: origin() }, { transform: 'none' },
    ], { duration: 680, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
    let closing = false;
    dismiss.current = () => {
      if (closing) return;
      closing = true;
      clearTimeout(timer);
      if (reduced) { onClose(); return; }
      animation?.cancel();
      animation = mascot.animate([{ transform: 'none' }, { transform: origin() }], {
        duration: 320, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards',
      });
      void animation.finished.then(onClose, () => {});
    };
    const timer = setTimeout(() => dismiss.current(), 6000);
    return () => { clearTimeout(timer); animation?.cancel(); overlay.close(); };
  }, [source, reduced, onClose]);

  return createPortal(
    <dialog ref={dialog} className="ask-oli-tickle" aria-labelledby={message}
      onCancel={event => { event.preventDefault(); dismiss.current(); }}
      onClick={event => { if (event.target === event.currentTarget) dismiss.current(); }}>
      <button type="button" autoFocus className="ask-oli-tickle-close" aria-label={t('Back to chat')} onClick={() => dismiss.current()}>
        <X size={22} aria-hidden="true" />
      </button>
      <div className="ask-oli-tickle-stage">
        <div ref={character} className="ask-oli-tickle-character">
          <div className="ask-oli-tickle-sway" data-oli-expression="thinking">
            <Oli size={760} particles={2200} state="thinking" speed={1.15} paused={reduced} followCursor />
          </div>
          <p id={message} className="ask-oli-tickle-message">{t('HEY, that tickles!')}</p>
        </div>
      </div>
    </dialog>, document.body,
  );
}
