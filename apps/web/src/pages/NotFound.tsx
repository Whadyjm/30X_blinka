import { Link } from 'react-router';
import { buttonClass } from '@/components/ui/Button';
import { t } from '@/i18n';

export function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div>
        <p className="caption">404</p>
        <h1 className="mt-1 text-[40px] leading-[1.05]">{t('This page doesn’t exist')}</h1>
        <Link to="/" className={buttonClass('primary', 'md', 'mt-6')}>
          {t('Back home')}
        </Link>
      </div>
    </div>
  );
}
