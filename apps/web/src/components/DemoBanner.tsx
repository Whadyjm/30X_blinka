import { useEffect, useState } from 'react';
import { FlaskConical, ShieldCheck } from 'lucide-react';
import { mockControls } from '@/api';
import { brand } from '@/config/brand';
import { env } from '@/config/env';
import { t } from '@/i18n';

/** Always visible. Required by the brief: nobody should think real money is moving. */
export function DemoBanner() {
  const [controls, setControls] = useState<Awaited<ReturnType<typeof mockControls>>>(null);
  useEffect(() => {
    void mockControls().then(setControls);
  }, []);

  return (
    <div className="flex flex-wrap items-center justify-start gap-x-5 gap-y-1 bg-obsidian px-4 py-2 text-[11px] uppercase tracking-[0.05em] text-white sm:justify-center" role="note">
      <span className="inline-flex items-center gap-1.5">
        <ShieldCheck className="size-3.5 text-highlighter" aria-hidden />
        {brand.envLabel}
      </span>
      {env.apiMode === 'mock' && (
        <span className="inline-flex flex-wrap items-center gap-3 text-slate-400">
          <FlaskConical className="size-3.5 text-highlighter" aria-hidden />
          {t('Mock API — no backend connected')}
          {controls && (
            <>
              <button
                type="button"
                className="uppercase underline underline-offset-2 hover:text-white"
                onClick={() => {
                  controls.reset();
                  window.location.assign('/login');
                }}
              >
                {t('Reset demo data')}
              </button>
              <button
                type="button"
                className="uppercase underline underline-offset-2 hover:text-white"
                onClick={() => {
                  controls.startOnboarding();
                  window.location.assign('/onboarding');
                }}
              >
                {t('Preview onboarding')}
              </button>
            </>
          )}
        </span>
      )}
    </div>
  );
}
