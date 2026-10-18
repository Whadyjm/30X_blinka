/**
 * Spanish dictionary. Key = exact English source string passed to t().
 * Split by area so they can be edited independently; merged here.
 * Run `node tools/check-i18n.mjs` to list t('…') literals that have no entry.
 */
import { esPerformance } from './es.performance';
import { esCore } from './es.core';
import { esShell } from './es.shell';
import { esBills } from './es.bills';
import { esRules } from './es.rules';
import { esIntegrations } from './es.integrations';
import { esEmail } from './es.email';
import { esChat } from './es.chat';
import { esOnboarding } from './es.onboarding';
import { esDashboard } from './es.dashboard';
import { esUsage } from './es.usage';

export const es: Record<string, string> = {
  ...esUsage,
  ...esCore,
  ...esShell,
  ...esBills,
  ...esRules,
  ...esIntegrations,
  ...esEmail,
  ...esChat,
  ...esOnboarding,
  ...esDashboard,
  ...esPerformance,
};
