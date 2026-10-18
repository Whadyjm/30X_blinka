import { t } from '@/i18n';

/** Standard error from the API (§13) or a transport failure. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(opts: { status: number; code: string; message: string; details?: unknown; requestId?: string }) {
    super(opts.message);
    this.name = 'ApiError';
    this.status = opts.status;
    this.code = opts.code;
    this.details = opts.details;
    this.requestId = opts.requestId;
  }

  get isUnauthorized() {
    return this.status === 401;
  }
  get isForbidden() {
    return this.status === 403;
  }
  get isNetwork() {
    return this.status === 0;
  }
}

export type ContractIssue = { path: PropertyKey[]; message: string };

/** The server answered 2xx but the body does not match the agreed contract. */
export class ContractError extends Error {
  readonly endpoint: string;
  readonly issues: ContractIssue[];

  constructor(endpoint: string, issues: ContractIssue[]) {
    const first = issues[0];
    super(`Contract mismatch on ${endpoint}: ${first ? `${first.path.join('.') || '(root)'} — ${first.message}` : 'invalid body'}`);
    this.name = 'ContractError';
    this.endpoint = endpoint;
    this.issues = issues;
  }
}

/** Short, human, non-leaky message for the UI. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'CHAT_RETRY_LIMIT') return t('This message has reached its retry limit. You can write a new message or start a new conversation.');
    if (e.isNetwork) return t('Can’t reach the server. Check your connection and try again.');
    if (e.isForbidden) return e.message || t('You don’t have permission to do that.');
    return e.message || t('Something went wrong.');
  }
  if (e instanceof ContractError) {
    return t('The server replied in an unexpected format. This is a bug, not something you did.');
  }
  return e instanceof Error ? e.message : t('Something went wrong.');
}
