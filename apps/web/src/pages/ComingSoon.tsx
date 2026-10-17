import { PageHeader, Card, EmptyState } from '@/components/ui/Card';
import { t } from '@/i18n';

/** Placeholder for P1 routes that are feature-flagged on but not built yet. `title` is an English i18n key. */
export function ComingSoon({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={t(title)} />
      <Card>
        <EmptyState title={t('Not built yet')} body={t('This is a P1 feature. It stays hidden until the core invoice flow is solid.')} />
      </Card>
    </>
  );
}
