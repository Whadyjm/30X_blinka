import { brand } from '@/config/brand';
import '@/styles/logo.css';

// Un único listener compartido: pausa las animaciones con la pestaña oculta.
if (typeof document !== 'undefined') {
  const sync = () => document.documentElement.toggleAttribute('data-tab-hidden', document.hidden);
  document.addEventListener('visibilitychange', sync);
  sync();
}

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg viewBox="0 0 36 36" className={`size-8 shrink-0 ${light ? 'text-white' : 'text-ink'}`} aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M18.2 3C26.8 3 33 9.1 33 17.7 33 26.7 26.9 33 18.1 33 9.5 33 3 26.8 3 18.2 3 9.4 9.5 3 18.2 3Z" />
        <g className="oli-logo-gaze">
          <g className={light ? 'fill-ink' : 'fill-highlighter'}>
            <rect className="oli-logo-eye" x="12.2" y="15" width="3.6" height="7" rx="1.8" />
            <rect className="oli-logo-eye" x="20.2" y="15" width="3.6" height="7" rx="1.8" />
          </g>
          <g className={`oli-logo-brows ${light ? 'stroke-ink' : 'stroke-highlighter'}`} fill="none" strokeWidth="1.6" strokeLinecap="round">
            <path d="M11.7 12.3c1.2-.9 2.9-1.1 4.4-.5" />
            <path d="M20 11.8c1.5-.6 3.2-.4 4.4.5" />
          </g>
        </g>
      </svg>
      <span className={`text-xl tracking-tight ${light ? 'text-white' : 'text-ink'}`}>{brand.name}</span>
    </span>
  );
}
