/**
 * Spanish dictionary. Key = exact English source string passed to t().
 * Split by area so they can be edited independently; merged here.
 * Run `node tools/check-i18n.mjs` to list t('…') literals that have no entry.
 */
import { esCore } from './es.core';
import { esShell } from './es.shell';
import { esBills } from './es.bills';
import { esRules } from './es.rules';
import { esIntegrations } from './es.integrations';

export const es: Record<string, string> = {
  ...esCore,
  ...esShell,
  ...esBills,
  ...esRules,
  ...esIntegrations,
};
