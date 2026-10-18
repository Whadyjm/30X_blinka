import { t } from '@/i18n';

export function chatFailureMessage(code: string | null): string {
  return t(code === 'CHAT_TOOL_LIMIT'
    ? 'I could not finish this request. We can make one change first and then the next, or register up to 20 vendors together. No changes were applied.'
    : 'This message failed. Please try again.');
}
