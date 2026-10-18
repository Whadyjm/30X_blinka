import { t } from '@/i18n';

export function chatFailureMessage(code: string | null): string {
  return t(code === 'CHAT_TOOL_LIMIT'
    ? 'Oli reached the limit of queries or proposals for this message. Ask for a batch of up to 20 vendors, or split other tasks into smaller steps. No changes were applied.'
    : 'This message failed. Please try again.');
}
